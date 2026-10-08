// @ts-nocheck
import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { successResponse, errorResponse, getPaginationParams, createAuditLog, getClientIp, serverTimestamp } from '../utils/helpers';

// Community Discussion moderation — community_posts + their comments
// subcollection. Separate from posts.controller.ts (Rishta Posting, which
// has no comments) so the two admin moderation surfaces never get mixed.

// Helper: look up a display identity for a uid (mirrors reports.controller.ts's
// getUserInfo, trimmed to the fields the posts admin UI actually needs).
async function getUserBrief(uid: string | undefined | null) {
  if (!uid || typeof uid !== 'string') return null;
  try {
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return {
      name: data?.displayName || 'Unknown User',
      email: data?.email || '',
    };
  } catch (_) {
    return null;
  }
}

export async function getPosts(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit } = getPaginationParams(req.query);
    const { status, communityId } = req.query as { status?: string; communityId?: string };

    let query: FirebaseFirestore.Query = db.collection('community_posts');
    if (status && status !== 'all') {
      query = query.where('status', '==', status);
    }
    if (communityId) {
      query = query.where('communityId', '==', communityId);
    }
    query = query.orderBy('createdAt', 'desc');

    const snap = await query.offset((page - 1) * limit).limit(limit).get();
    // Firestore doesn't support a count() on an arbitrarily-filtered query
    // cheaply here across multiple optional filters — reuse the same query
    // shape (minus offset/limit) for the count, matching getPendingPhotos'
    // existing pattern of a parallel count() call.
    let countQuery: FirebaseFirestore.Query = db.collection('community_posts');
    if (status && status !== 'all') countQuery = countQuery.where('status', '==', status);
    if (communityId) countQuery = countQuery.where('communityId', '==', communityId);
    const countSnap = await countQuery.count().get();
    const total = countSnap.data().count;

    const posts = await Promise.all(
      snap.docs.map(async (doc) => {
        const data = doc.data();
        const author = await getUserBrief(data.authorUid);
        return {
          id: doc.id,
          communityId: data.communityId,
          authorUid: data.authorUid,
          author,
          authorDisplayName: data.authorDisplayName,
          text: data.text,
          category: data.category || 'general',
          imageUrl: data.imageUrl || null,
          status: data.status,
          moderatedBy: data.moderatedBy || null,
          moderationReason: data.moderationReason || null,
          likeCount: data.likeCount || 0,
          commentCount: data.commentCount || 0,
          reportCount: data.reportCount || 0,
          createdAt: data.createdAt,
        };
      })
    );

    res.json(successResponse({
      data: posts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1, hasMore: page * limit < total },
    }));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch community posts', error));
  }
}

async function moderatePost(req: Request, res: Response, status: 'active' | 'hidden' | 'removed', action: string): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const { reason } = req.body as { reason?: string };

    const postRef = db.collection('community_posts').doc(id);
    const postDoc = await postRef.get();
    if (!postDoc.exists) {
      res.status(404).json(errorResponse('Post not found'));
      return;
    }

    await postRef.update({
      status,
      moderatedBy: req.admin!.uid,
      moderatedAt: serverTimestamp(),
      moderationReason: reason || null,
      updatedAt: serverTimestamp(),
    });

    await createAuditLog({
      adminId: req.admin!.uid,
      adminEmail: req.admin!.email,
      action,
      targetId: id,
      targetType: 'post',
      details: { newStatus: status, reason: reason || null },
      timestamp: serverTimestamp() as any,
      ip: getClientIp(req) as string,
    });

    const verb = action === 'APPROVE_COMMUNITY_POST' ? 'approved' : status === 'active' ? 'restored' : status;
    res.json(successResponse(null, `Post ${verb}`));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to moderate post', error));
  }
}

export const hidePost = (req: Request, res: Response) => moderatePost(req, res, 'hidden', 'HIDE_COMMUNITY_POST');
export const unhidePost = (req: Request, res: Response) => moderatePost(req, res, 'active', 'UNHIDE_COMMUNITY_POST');
export const removePost = (req: Request, res: Response) => moderatePost(req, res, 'removed', 'REMOVE_COMMUNITY_POST');
// Approve a pending community post → makes it 'active' (live in the feed).
// Community posts are created as 'pending' and stay hidden from everyone but
// their author until an admin approves them here.
export const approvePost = (req: Request, res: Response) => moderatePost(req, res, 'active', 'APPROVE_COMMUNITY_POST');

export async function getComments(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit } = getPaginationParams(req.query);
    const { postId, status } = req.query as { postId?: string; status?: string };

    // collectionGroup query — lets moderation see every comment across
    // every post's subcollection without needing to enumerate posts first.
    let query: FirebaseFirestore.Query = db.collectionGroup('comments');
    if (status && status !== 'all') query = query.where('status', '==', status);
    if (postId) query = query.where('postId', '==', postId);
    query = query.orderBy('createdAt', 'desc');

    const snap = await query.offset((page - 1) * limit).limit(limit).get();
    const comments = await Promise.all(
      snap.docs.map(async (doc) => {
        const data = doc.data();
        const author = await getUserBrief(data.authorUid);
        return {
          id: doc.id,
          postId: data.postId,
          authorUid: data.authorUid,
          author,
          text: data.text,
          status: data.status,
          parentCommentId: data.parentCommentId || null,
          createdAt: data.createdAt,
        };
      })
    );

    res.json(successResponse({ data: comments, pagination: { page, limit, total: comments.length, totalPages: 1, hasMore: false } }));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch comments', error));
  }
}

async function moderateComment(req: Request, res: Response, status: 'active' | 'hidden' | 'removed', action: string): Promise<void> {
  try {
    const { postId, commentId } = req.params as { postId: string; commentId: string };
    const { reason } = req.body as { reason?: string };

    const commentRef = db.collection('community_posts').doc(postId).collection('comments').doc(commentId);
    const commentDoc = await commentRef.get();
    if (!commentDoc.exists) {
      res.status(404).json(errorResponse('Comment not found'));
      return;
    }

    await commentRef.update({
      status,
      moderatedBy: req.admin!.uid,
      moderatedAt: serverTimestamp(),
      moderationReason: reason || null,
      updatedAt: serverTimestamp(),
    });

    await createAuditLog({
      adminId: req.admin!.uid,
      adminEmail: req.admin!.email,
      action,
      targetId: commentId,
      targetType: 'comment',
      details: { postId, newStatus: status, reason: reason || null },
      timestamp: serverTimestamp() as any,
      ip: getClientIp(req) as string,
    });

    res.json(successResponse(null, `Comment ${status === 'active' ? 'restored' : status}`));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to moderate comment', error));
  }
}

export const hideComment = (req: Request, res: Response) => moderateComment(req, res, 'hidden', 'HIDE_COMMUNITY_COMMENT');
export const removeComment = (req: Request, res: Response) => moderateComment(req, res, 'removed', 'REMOVE_COMMUNITY_COMMENT');
// Restore a hidden/removed comment back to active (posts already had unhide;
// comments did not, so a mistakenly-moderated comment couldn't be reinstated).
export const restoreComment = (req: Request, res: Response) => moderateComment(req, res, 'active', 'RESTORE_COMMUNITY_COMMENT');
