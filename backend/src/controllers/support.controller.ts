// @ts-nocheck
import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { r2Client, r2Buckets } from '../config/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { successResponse, errorResponse, getPaginationParams, createAuditLog, getClientIp } from '../utils/helpers';
import { FieldValue } from 'firebase-admin/firestore';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { notifyUser } from './users.controller';

// Support attachments are uploaded straight to Cloudflare R2 (in-memory,
// no local disk) — Vercel's filesystem is ephemeral per-invocation, so
// writing to local disk (the previous approach) never actually persisted.
const uploadStorage = multer.memoryStorage();

export const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Helper: Look up a user's displayName from the users collection, fallback gracefully
async function resolveUserDisplayName(userId: string, storedName: string): Promise<string> {
  if (storedName && storedName.trim().length > 0) return storedName.trim();
  if (!userId) return 'Unknown User';
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      if (data?.displayName) return data.displayName;
      if (data?.name) return data.name;
      if (data?.email) return data.email.split('@')[0];
    }
  } catch (_) {}
  return 'Unknown User';
}

export async function getTickets(req: Request, res: Response): Promise<void> {
  try {
    const { status, limit, lastVisible } = req.query;
    const { limit: limitNum } = getPaginationParams(req);

    let query: FirebaseFirestore.Query = db.collection('support_tickets').orderBy('updatedAt', 'desc');

    if (status) {
      query = query.where('status', '==', status as string);
    }

    if (lastVisible) {
      const lastDoc = await db.collection('support_tickets').doc(lastVisible as string).get();
      if (lastDoc.exists) {
        query = query.startAfter(lastDoc);
      }
    }

    query = query.limit(limitNum);
    const snapshot = await query.get();

    // Enrich each ticket with the actual user display name
    const tickets = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const data = doc.data();
        const userDisplayName = await resolveUserDisplayName(data.userId, data.userDisplayName);
        return { id: doc.id, ...data, userDisplayName };
      })
    );

    res.json(successResponse({
      tickets,
      lastVisible: snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : null,
      hasMore: snapshot.docs.length === limitNum
    }));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch support tickets', error));
  }
}

export async function getTicketDetails(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const ticketDoc = await db.collection('support_tickets').doc(id).get();

    if (!ticketDoc.exists) {
      res.status(404).json(errorResponse('Ticket not found'));
      return;
    }

    // Reset unread count for admin
    await ticketDoc.ref.update({
      unreadCountAdmin: 0
    });

    // Mark unread user messages as read
    const unreadMsgsSnap = await ticketDoc.ref.collection('messages')
      .where('senderType', '==', 'user')
      .where('isRead', '==', false)
      .get();

    if (!unreadMsgsSnap.empty) {
      const batch = db.batch();
      unreadMsgsSnap.docs.forEach(doc => {
        batch.update(doc.ref, { isRead: true });
      });
      await batch.commit();
    }

    const ticketData = ticketDoc.data();

    // Enrich ticket with resolved displayName
    const userDisplayName = await resolveUserDisplayName(ticketData?.userId, ticketData?.userDisplayName);

    // Fetch messages
    const messagesSnap = await ticketDoc.ref.collection('messages').orderBy('timestamp', 'asc').get();
    const messages = messagesSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(successResponse({
      ticket: { id: ticketDoc.id, ...ticketData, userDisplayName },
      messages
    }));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch ticket details', error));
  }
}

export async function uploadSupportAttachment(req: Request, res: Response): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json(errorResponse('No file uploaded'));
      return;
    }

    const ext = path.extname(req.file.originalname) || '.jpg';
    const filename = `support_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
    const fileKey = filename;
    let fileUrl = '';

    try {
      await r2Client.send(new PutObjectCommand({
        Bucket: r2Buckets.support.bucket,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }));
      fileUrl = `${r2Buckets.support.domain}/${fileKey}`;
    } catch (r2Err) {
      console.warn('[Support] R2 upload failed, falling back to data URL:', r2Err);
      const b64 = req.file.buffer.toString('base64');
      fileUrl = `data:${req.file.mimetype};base64,${b64}`;
    }

    res.json(successResponse({
      url: fileUrl,
      filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
    }, 'File uploaded successfully'));
  } catch (error) {
    console.error('[Support] uploadSupportAttachment error:', error);
    res.status(500).json(errorResponse('Failed to upload attachment', error));
  }
}

export async function updateTicketStatus(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { status } = req.body;

    if (!status) {
      res.status(400).json(errorResponse('Status is required'));
      return;
    }

    const ticketRef = db.collection('support_tickets').doc(id);
    const ticketSnap = await ticketRef.get();
    const ticketData = ticketSnap.data();

    await ticketRef.update({
      status,
      updatedAt: FieldValue.serverTimestamp()
    });

    // Tell the reporting user their ticket was resolved — this previously
    // never happened at all (the status changed, nothing told them). Uses
    // the same 'bug_resolved' type + relatedId the Flutter tap-handler
    // (push_notification_service.dart) already had routing logic for,
    // waiting on a notification that was never actually sent.
    if (status === 'Resolved' && ticketData?.userId) {
      const category = ticketData.category ? `${ticketData.category} report` : 'support ticket';
      await notifyUser(
        ticketData.userId,
        'Your report has been resolved ✅',
        `Your ${category} has been reviewed and marked as resolved. Tap to view the conversation.`,
        'bug_resolved',
        { relatedId: id }
      );
    }

    // Log activity (per-ticket history shown in the ticket detail view)
    await db.collection('ticket_activity').add({
      ticketId: id,
      action: 'STATUS_CHANGED',
      adminId: (req as any).admin?.uid || 'system',
      details: `Status changed to ${status}`,
      timestamp: FieldValue.serverTimestamp()
    });

    // Also record on the global Audit Logs page, alongside every other
    // admin-mutating action.
    await createAuditLog({
      adminId: (req as any).admin?.uid || 'system',
      adminEmail: (req as any).admin?.email || 'system',
      action: 'UPDATE_TICKET_STATUS',
      targetId: id,
      targetType: 'support_ticket' as any,
      details: { status },
      timestamp: new Date(),
      ip: getClientIp(req),
    });

    res.json(successResponse(null, 'Ticket status updated successfully'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to update ticket status', error));
  }
}

export async function assignTicket(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const adminId = (req as any).admin?.uid;

    if (!adminId) {
      res.status(401).json(errorResponse('Unauthorized'));
      return;
    }

    const ticketRef = db.collection('support_tickets').doc(id);
    await ticketRef.update({
      assignedAdminId: adminId,
      status: 'Open',
      updatedAt: FieldValue.serverTimestamp()
    });

    // Log activity (per-ticket history shown in the ticket detail view)
    await db.collection('ticket_activity').add({
      ticketId: id,
      action: 'TICKET_ASSIGNED',
      adminId: adminId,
      details: 'Admin claimed the ticket',
      timestamp: FieldValue.serverTimestamp()
    });

    await createAuditLog({
      adminId,
      adminEmail: (req as any).admin?.email || 'system',
      action: 'ASSIGN_TICKET',
      targetId: id,
      targetType: 'support_ticket' as any,
      details: {},
      timestamp: new Date(),
      ip: getClientIp(req),
    });

    res.json(successResponse(null, 'Ticket assigned successfully'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to assign ticket', error));
  }
}

export async function sendAdminReply(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { content = '', type = 'text', mediaUrl = null } = req.body;

    if (!content && !mediaUrl) {
      res.status(400).json(errorResponse('Content or mediaUrl is required'));
      return;
    }

    const adminId = (req as any).admin?.uid || 'admin';
    const msgRef = db.collection('support_tickets').doc(id).collection('messages').doc();

    const msgType = mediaUrl ? 'image' : (type || 'text');

    await msgRef.set({
      senderId: adminId,
      senderType: 'admin',
      content: content || '',
      type: msgType,
      mediaUrl: mediaUrl || null,
      isRead: false,
      delivered: true,
      timestamp: FieldValue.serverTimestamp()
    });

    // Update ticket metadata
    const ticketRef = db.collection('support_tickets').doc(id);
    await ticketRef.update({
      updatedAt: FieldValue.serverTimestamp(),
      lastMessage: content || (mediaUrl ? '[Photo Attachment]' : ''),
      status: 'Waiting for User'
    });

    // NOT notifying here on purpose: functions/src/index.ts's
    // onSupportMessageSent Cloud Function trigger already fires on this
    // same support_tickets/{id}/messages/{messageId} create event and
    // sends the user a push (see that file — it was fixed there to use a
    // proper support_reply type + relatedId instead of the generic 'alert'
    // it used to send). Notifying here too would double-send.

    res.json(successResponse({ messageId: msgRef.id }, 'Reply sent successfully'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to send reply', error));
  }
}

export async function getUnreadTicketsCount(req: Request, res: Response): Promise<void> {
  try {
    // count() aggregate — polled every 5s by the sidebar badge, so don't
    // download the ticket documents just to count them.
    const snapshot = await db.collection('support_tickets')
      .where('unreadCountAdmin', '>', 0)
      .count()
      .get();
    res.json(successResponse({ count: snapshot.data().count }));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch unread count', error));
  }
}
