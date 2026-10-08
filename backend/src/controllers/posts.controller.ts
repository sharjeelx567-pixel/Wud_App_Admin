// @ts-nocheck
import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { successResponse, errorResponse, getPaginationParams, createAuditLog, getClientIp, serverTimestamp } from '../utils/helpers';

// Rishta Posting moderation — rishta_posts has no comments subcollection
// (that's a Community Discussion concept only, see
// community-posts.controller.ts), so this file is posts-only.

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
    const { status } = req.query as { status?: string };

    let query: FirebaseFirestore.Query = db.collection('rishta_posts');
    if (status && status !== 'all') {
      query = query.where('status', '==', status);
    }
    query = query.orderBy('createdAt', 'desc');

    const snap = await query.offset((page - 1) * limit).limit(limit).get();
    let countQuery: FirebaseFirestore.Query = db.collection('rishta_posts');
    if (status && status !== 'all') countQuery = countQuery.where('status', '==', status);
    const countSnap = await countQuery.count().get();
    const total = countSnap.data().count;

    const posts = await Promise.all(
      snap.docs.map(async (doc) => {
        const data = doc.data();
        const author = await getUserBrief(data.authorUid);
        return {
          id: doc.id,
          authorUid: data.authorUid,
          author,
          displayName: data.displayName,
          age: data.age,
          gender: data.gender,
          city: data.city,
          photoUrl: data.photoUrl || null,
          aboutMe: data.aboutMe,
          status: data.status,
          moderatedBy: data.moderatedBy || null,
          moderationReason: data.moderationReason || null,
          likeCount: data.likeCount || 0,
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
    res.status(500).json(errorResponse('Failed to fetch rishta posts', error));
  }
}

async function moderatePost(req: Request, res: Response, status: 'active' | 'hidden' | 'removed', action: string): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const { reason } = req.body as { reason?: string };

    const postRef = db.collection('rishta_posts').doc(id);
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

    const verb = action === 'APPROVE_POST' ? 'approved' : status === 'active' ? 'restored' : status;
    res.json(successResponse(null, `Post ${verb}`));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to moderate post', error));
  }
}

export const hidePost = (req: Request, res: Response) => moderatePost(req, res, 'hidden', 'HIDE_POST');
export const unhidePost = (req: Request, res: Response) => moderatePost(req, res, 'active', 'UNHIDE_POST');
export const removePost = (req: Request, res: Response) => moderatePost(req, res, 'removed', 'REMOVE_POST');
// Approve a pending Rishta post → makes it 'active' (live in the feed).
// Rishta posts are created as 'pending' and stay hidden from everyone but
// their author until an admin approves them here.
export const approvePost = (req: Request, res: Response) => moderatePost(req, res, 'active', 'APPROVE_POST');
