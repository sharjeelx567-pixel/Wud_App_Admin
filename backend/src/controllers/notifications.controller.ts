// @ts-nocheck
import { Request, Response } from 'express';
import { db, admin } from '../config/firebase';
import { successResponse, errorResponse, getPaginationParams, serverTimestamp } from '../utils/helpers';
import { FieldPath, WriteBatch } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logAction } from './audit.controller';

export async function sendNotification(req: Request, res: Response): Promise<void> {
  try {
    const { title, body, scheduledAt } = req.body;
    const audience = req.body.audience || req.body.target || 'all';
    const targetUid = req.body.targetUid || req.body.userId || null;

    // Validate: non-empty, bounded title/body; a known audience; and a
    // targetUid when audience is 'specific'. Previously the raw body was
    // trusted, so a huge title/body or an unknown audience was accepted.
    if (typeof title !== 'string' || typeof body !== 'string' || !title.trim() || !body.trim()) {
      res.status(400).json(errorResponse('Notification title and message body are required.'));
      return;
    }
    if (title.length > 120 || body.length > 1000) {
      res.status(400).json(errorResponse('Title must be ≤120 and body ≤1000 characters.'));
      return;
    }
    const ALLOWED_AUDIENCES = ['all', 'premium', 'verified', 'male', 'female', 'specific'];
    if (!ALLOWED_AUDIENCES.includes(audience)) {
      res.status(400).json(errorResponse('Unknown audience.'));
      return;
    }
    if (audience === 'specific' && (!targetUid || typeof targetUid !== 'string')) {
      res.status(400).json(errorResponse('A target user is required for a direct notification.'));
      return;
    }
    if (scheduledAt && isNaN(new Date(scheduledAt).getTime())) {
      res.status(400).json(errorResponse('Invalid schedule date.'));
      return;
    }

    const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
    const isScheduled = scheduledDate && scheduledDate > new Date();

    if (isScheduled) {
      // Create a scheduled notification task in Firestore
      const docRef = await db.collection('scheduled_notifications').add({
        title,
        body,
        audience,
        targetUid,
        scheduledAt: scheduledDate,
        status: 'pending',
        sentBy: req.admin?.uid || 'admin',
        createdAt: serverTimestamp(),
      });

      res.json(successResponse({ id: docRef.id }, 'Notification scheduled successfully.'));
      return;
    }

    // Immediate dispatch
    let query: FirebaseFirestore.Query = db.collection('users');

    if (audience === 'premium') {
      query = query.where('isPremium', '==', true);
    } else if (audience === 'verified') {
      query = query.where('isVerified', '==', true);
    } else if (audience === 'male') {
      query = query.where('gender', 'in', ['Male', 'male']);
    } else if (audience === 'female') {
      query = query.where('gender', 'in', ['Female', 'female']);
    } else if (audience === 'specific') {
      if (!targetUid) {
        res.status(400).json(errorResponse('targetUid is required for specific audience'));
        return;
      }
      query = query.where(FieldPath.documentId(), '==', targetUid);
    }

    const snapshot = await query.get();
    const tokenSet = new Set<string>();

    const batches: WriteBatch[] = [];
    let currentBatch = db.batch();
    let count = 0;

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.fcmToken) {
        tokenSet.add(data.fcmToken);
      }

      const notifRef = doc.ref.collection('notifications').doc();
      currentBatch.set(notifRef, {
        title,
        body,
        isRead: false,
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp()
      });

      count++;
      if (count === 500) {
        batches.push(currentBatch);
        currentBatch = db.batch();
        count = 0;
      }
    });

    if (count > 0) {
      batches.push(currentBatch);
    }

    if (batches.length > 0) {
      await Promise.all(batches.map(b => b.commit()));
    }

    const tokens = Array.from(tokenSet);
    let successCount = 0;
    let failureCount = 0;

    if (tokens.length > 0) {
      // Send multicast notification using Firebase Admin SDK
      const message = {
        notification: { title, body },
        tokens: tokens,
      };

      try {
        const response = await getMessaging().sendEachForMulticast(message);
        successCount = response.successCount;
        failureCount = response.failureCount;
      } catch (err) {
        console.error('[Notifications] Multicast send error:', err);
      }
    }

    // Save to history log
    const docRef = await db.collection('notifications_log').add({
      title,
      body,
      audience,
      targetUid: targetUid || null,
      sentAt: serverTimestamp(),
      sentBy: req.admin?.uid || 'admin',
      successCount,
      failureCount,
      totalTargets: snapshot.size,
    });

    // Audit Log
    if (req.admin) {
      await logAction(
        req.admin.uid,
        req.admin.email,
        'notification_broadcast_sent',
        docRef.id,
        'notification',
        { title, audience, totalTargets: snapshot.size, fcmDevices: tokens.length },
        req.ip || ''
      );
    }

    res.json(successResponse({
      id: docRef.id,
      successCount,
      failureCount,
      totalTargets: snapshot.size,
    }, 'Notification broadcast dispatched successfully.'));

  } catch (error: any) {
    console.error('[Notifications] Send error:', error);
    res.status(500).json(errorResponse('Failed to send notification', error.message || error));
  }
}

export async function getNotificationHistory(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit } = getPaginationParams(req.query);

    const snapshot = await db.collection('notifications_log')
      .orderBy('sentAt', 'desc')
      .offset((page - 1) * limit)
      .limit(limit)
      .get();

    const countSnap = await db.collection('notifications_log').count().get();
    const total = countSnap.data().count;

    const history = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(successResponse({
      data: history,
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    }));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch notification history', error));
  }
}

export async function getScheduledNotifications(req: Request, res: Response): Promise<void> {
  try {
    const snapshot = await db.collection('scheduled_notifications')
      .where('status', '==', 'pending')
      .orderBy('scheduledAt', 'asc')
      .get();

    const scheduled = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(successResponse(scheduled));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch scheduled notifications', error));
  }
}

export async function deleteScheduledNotification(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    await db.collection('scheduled_notifications').doc(id).delete();
    res.json(successResponse(null, 'Scheduled notification cancelled'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to cancel notification', error));
  }
}
