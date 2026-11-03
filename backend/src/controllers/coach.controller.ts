// @ts-nocheck
import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { admin as firebaseAdmin, db } from '../config/firebase';
import { successResponse, errorResponse, serverTimestamp } from '../utils/helpers';
import { FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

// Marriage Coach bookings (see grantTestItem 'coach_session' in
// functions/src/premium/mockPayment.ts) land in `coach_sessions` with the paid
// topic/date/time and the 30% platform / 70% coach split, but nothing in the
// admin panel could see them or hand the user a coach + call link. This gives
// staff a queue to assign a coach, send the Google Meet link, and mark the
// session confirmed / completed / cancelled — the app reads those fields live.

// Mirrors verification.controller's sendPush: writes the user's notifications
// subcollection (so it shows in-app) and sends FCM if a token exists.
async function sendPush(uid: string, title: string, body: string, extraData?: Record<string, string>) {
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    const fcmToken = userDoc.data()?.fcmToken;
    await db.collection('users').doc(uid).collection('notifications').add({
      title,
      body,
      isRead: false,
      timestamp: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      ...extraData,
    });
    if (fcmToken) {
      await getMessaging().send({ token: fcmToken, notification: { title, body } });
    }
  } catch (err) {
    console.error('[Coach] Push notification failed:', err);
  }
}

// GET /coach/sessions?status=booked  — list bookings, newest first, enriched
// with the booker's display name / email / phone for the admin table.
export async function getCoachSessions(req: Request, res: Response): Promise<void> {
  try {
    const { status } = req.query;
    const snapshot = await db.collection('coach_sessions').get();

    let sessions = await Promise.all(
      snapshot.docs.map(async (doc: any) => {
        const data = doc.data();
        let userName = '';
        let userEmail = '';
        let userPhone = '';
        if (data.userId) {
          const userDoc = await db.collection('users').doc(data.userId).get();
          const user = userDoc.data() || {};
          userName = user.displayName || '';
          userEmail = user.email || '';
          userPhone = user.phoneNumber || user.phone || '';
        }
        return {
          id: doc.id,
          ...data,
          userName,
          userEmail,
          userPhone,
          createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : 0,
        };
      })
    );

    // Order in memory (newest first) so a missing index can never empty the
    // queue — the collection is small (one doc per paid booking).
    sessions.sort((a: any, b: any) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    if (status) sessions = sessions.filter((s: any) => (s.status || 'booked') === status);

    res.json(successResponse(sessions));
  } catch (error) {
    console.error('[Coach] getCoachSessions error:', error);
    res.status(500).json(errorResponse('Failed to fetch coach sessions', error));
  }
}

// PATCH /coach/sessions/:id — assign a coach, set the meeting link, and/or move
// the booking's status. Whatever changed, the user is notified and the app's
// "Your Sessions" card re-reads the new coach name / Join link live.
export async function updateCoachSession(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { coachName, coachId, meetingLink, status, adminNote } = req.body || {};

    const ref = db.collection('coach_sessions').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json(errorResponse('Coach session not found'));
      return;
    }
    const existing = snap.data() || {};

    const update: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };

    // Assigning a registered coach (preferred) resolves the display name from
    // the coach's admin account so the app and chat always show a real name;
    // a bare coachName string is still accepted for backward compatibility.
    if (coachId !== undefined) {
      if (coachId) {
        const coachDoc = await db.collection('admins').doc(coachId).get();
        if (!coachDoc.exists || coachDoc.data()?.role !== 'coach') {
          res.status(400).json(errorResponse('Selected coach is not a registered coach account.'));
          return;
        }
        update.coachId = coachId;
        update.coachName = coachDoc.data()?.displayName || null;
      } else {
        update.coachId = null;
        update.coachName = null;
      }
    } else if (typeof coachName === 'string') {
      update.coachName = coachName.trim() || null;
    }

    if (meetingLink !== undefined) {
      const link = (meetingLink || '').trim();
      if (link && !/^https?:\/\//i.test(link)) {
        res.status(400).json(errorResponse('A valid meeting link (https://…) is required.'));
        return;
      }
      update.meetingLink = link || null;
    }

    const validStatuses = ['booked', 'confirmed', 'completed', 'cancelled'];
    if (status !== undefined) {
      if (!validStatuses.includes(status)) {
        res.status(400).json(errorResponse(`status must be one of: ${validStatuses.join(', ')}`));
        return;
      }
      update.status = status;
      if (status === 'confirmed') update.confirmedAt = FieldValue.serverTimestamp();
      if (status === 'completed') update.completedAt = FieldValue.serverTimestamp();
      if (status === 'cancelled') update.cancelledAt = FieldValue.serverTimestamp();
    }

    if (typeof adminNote === 'string') update.adminNote = adminNote.trim() || null;

    await ref.update(update);

    // Audit trail (mirrors verification's admin_audit_logs writes).
    await db.collection('admin_audit_logs').doc().set({
      action: 'coach_session_updated',
      sessionId: id,
      userId: existing.userId || null,
      changes: { coachName: update.coachName, meetingLink: update.meetingLink, status: update.status },
      adminId: (req as any).admin?.uid || 'system',
      timestamp: FieldValue.serverTimestamp(),
    });

    // Notify the user about the most meaningful change.
    const uid = existing.userId;
    if (uid) {
      const topic = existing.topic || 'your session';
      const when = `${existing.date || ''}${existing.timeSlot ? ' · ' + existing.timeSlot : ''}`.trim();
      if (update.status === 'cancelled') {
        await sendPush(uid, 'Coach Session Update',
          `Your Marriage Coach session (${topic}) was cancelled. Please contact support if this is unexpected.`,
          { type: 'coach_session', coachSessionId: id });
      } else if (update.status === 'completed') {
        await sendPush(uid, 'Session Completed ✅',
          `Your Marriage Coach session (${topic}) is marked completed. We hope it helped — JazakAllah.`,
          { type: 'coach_session', coachSessionId: id });
      } else if (update.coachName) {
        await sendPush(uid, 'Coach Assigned 🧑‍🏫',
          `${update.coachName} is now your Marriage Coach for "${topic}"${when ? ' (' + when + ')' : ''}. Open Marriage Coach to start chatting.`,
          { type: 'coach_session', coachSessionId: id });
      }
    }

    res.json(successResponse(null, 'Coach session updated'));
  } catch (error) {
    console.error('[Coach] updateCoachSession error:', error);
    res.status(500).json(errorResponse('Failed to update coach session', error));
  }
}

// ─── Coach accounts ─────────────────────────────────────────────────────────

// Registered coaches = admin accounts with role 'coach'. Used by the assign
// dropdown and the Coaches management list on the Marriage Coach page.
export async function listCoaches(_req: Request, res: Response): Promise<void> {
  try {
    const snap = await db.collection('admins').where('role', '==', 'coach').get();
    const coaches = snap.docs.map((d: any) => {
      const x = d.data() || {};
      return {
        uid: d.id,
        displayName: x.displayName || '',
        email: x.email || '',
        isActive: x.isActive !== false,
      };
    });
    coaches.sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));
    res.json(successResponse(coaches));
  } catch (error) {
    console.error('[Coach] listCoaches error:', error);
    res.status(500).json(errorResponse('Failed to fetch coaches', error));
  }
}

// Register a coach = create a restricted admin account (role 'coach', default
// permission 'coach.chat' only). Mirrors admins.createAdmin's Firebase Auth +
// bcrypt + admins doc so the coach can log in to the same panel and sees only
// their chats. The coach signs in with this email + password.
export async function registerCoach(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !password || !displayName) {
      res.status(400).json(errorResponse('Missing required fields (email, password, displayName)'));
      return;
    }
    if (String(password).length < 6) {
      res.status(400).json(errorResponse('Password must be at least 6 characters.'));
      return;
    }
    const cleanEmail = String(email).toLowerCase().trim();

    const existing = await db.collection('admins').where('email', '==', cleanEmail).limit(1).get();
    if (!existing.empty) {
      res.status(409).json(errorResponse('An account with this email already exists'));
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    let userRecord: any;
    try {
      userRecord = await firebaseAdmin.auth().getUserByEmail(cleanEmail);
      await firebaseAdmin.auth().updateUser(userRecord.uid, { password, displayName });
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') {
        userRecord = await firebaseAdmin.auth().createUser({
          email: cleanEmail, password, displayName, emailVerified: true,
        });
      } else {
        throw e;
      }
    }

    await firebaseAdmin.auth().setCustomUserClaims(userRecord.uid, { admin: true, role: 'coach' });

    await db.collection('admins').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: cleanEmail,
      displayName,
      role: 'coach',
      permissions: [],
      passwordHash,
      isActive: true,
      createdAt: serverTimestamp(),
    });

    await db.collection('admin_audit_logs').doc().set({
      action: 'coach_registered',
      coachUid: userRecord.uid,
      email: cleanEmail,
      adminId: (req as any).admin?.uid || 'system',
      timestamp: FieldValue.serverTimestamp(),
    });

    res.status(201).json(
      successResponse({ uid: userRecord.uid, email: cleanEmail, displayName }, 'Coach registered')
    );
  } catch (error: any) {
    console.error('[Coach] registerCoach error:', error);
    res.status(500).json(errorResponse('Failed to register coach', error.message || error));
  }
}

// ─── Coach chat (the coach's own view) ──────────────────────────────────────

// Sessions assigned to the signed-in coach (super_admin sees all). This is the
// coach's "My Chats" list — booker name, last-message preview, unread count.
export async function getMyCoachThreads(req: Request, res: Response): Promise<void> {
  try {
    const me = (req as any).admin;
    const isSuper = me?.role === 'super_admin';
    let query: any = db.collection('coach_sessions');
    if (!isSuper) query = query.where('coachId', '==', me.uid);
    const snap = await query.get();

    const threads = await Promise.all(
      snap.docs.map(async (doc: any) => {
        const data = doc.data() || {};
        let userName = '';
        if (data.userId) {
          const u = await db.collection('users').doc(data.userId).get();
          userName = u.data()?.displayName || '';
        }
        const lastSnap = await doc.ref.collection('messages').orderBy('timestamp', 'desc').limit(1).get();
        const last = lastSnap.docs[0]?.data();
        const unreadSnap = await doc.ref
          .collection('messages')
          .where('senderType', '==', 'user')
          .where('isRead', '==', false)
          .get();
        return {
          id: doc.id,
          userId: data.userId,
          userName,
          topic: data.topic || '',
          date: data.date || '',
          timeSlot: data.timeSlot || '',
          status: data.status || 'booked',
          coachName: data.coachName || '',
          lastMessage: last?.text || '',
          lastMessageAt: last?.timestamp?.toMillis ? last.timestamp.toMillis() : 0,
          unreadCount: unreadSnap.size,
        };
      })
    );

    threads.sort((a: any, b: any) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
    res.json(successResponse(threads));
  } catch (error) {
    console.error('[Coach] getMyCoachThreads error:', error);
    res.status(500).json(errorResponse('Failed to fetch coach chats', error));
  }
}

// Messages in one session's thread. Only the assigned coach (or super_admin)
// may open it; opening marks the user's messages read.
export async function getCoachMessages(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const me = (req as any).admin;
    const ref = db.collection('coach_sessions').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json(errorResponse('Session not found'));
      return;
    }
    const data = snap.data() || {};
    if (me?.role !== 'super_admin' && data.coachId !== me.uid) {
      res.status(403).json(errorResponse('This chat is not assigned to you.'));
      return;
    }

    const msgsSnap = await ref.collection('messages').orderBy('timestamp', 'asc').get();
    const messages = msgsSnap.docs.map((d: any) => {
      const m = d.data();
      return {
        id: d.id,
        senderType: m.senderType,
        text: m.text,
        isRead: m.isRead === true,
        timestamp: m.timestamp?.toMillis ? m.timestamp.toMillis() : 0,
      };
    });

    // Only the assigned coach reading the thread clears the user's unread
    // receipts — a super_admin viewing for oversight stays invisible (doesn't
    // flip ticks blue or clear the coach's unread badge).
    if (me?.role !== 'super_admin') {
      const unread = msgsSnap.docs.filter(
        (d: any) => d.data().senderType === 'user' && d.data().isRead === false
      );
      if (unread.length) {
        const batch = db.batch();
        unread.forEach((d: any) => batch.update(d.ref, { isRead: true }));
        await batch.commit();
      }
    }

    res.json(
      successResponse({
        session: {
          id,
          userId: data.userId,
          userName: '',
          topic: data.topic || '',
          date: data.date || '',
          timeSlot: data.timeSlot || '',
          status: data.status || 'booked',
          coachName: data.coachName || '',
        },
        messages,
      })
    );
  } catch (error) {
    console.error('[Coach] getCoachMessages error:', error);
    res.status(500).json(errorResponse('Failed to fetch messages', error));
  }
}

// Coach → user message. Writes the thread message and notifies the user.
export async function sendCoachMessage(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const me = (req as any).admin;
    const text = (req.body?.text || '').trim();
    if (!text) {
      res.status(400).json(errorResponse('Message text is required'));
      return;
    }

    const ref = db.collection('coach_sessions').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json(errorResponse('Session not found'));
      return;
    }
    const data = snap.data() || {};
    if (me?.role !== 'super_admin' && data.coachId !== me.uid) {
      res.status(403).json(errorResponse('This chat is not assigned to you.'));
      return;
    }

    await ref.collection('messages').add({
      senderId: me.uid,
      senderType: 'coach',
      text,
      isRead: false,
      timestamp: FieldValue.serverTimestamp(),
    });
    await ref.update({
      lastMessageAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (data.userId) {
      await sendPush(
        data.userId,
        `Message from your coach${data.coachName ? ' ' + data.coachName : ''} 🧑‍🏫`,
        text.length > 90 ? text.slice(0, 90) + '…' : text,
        { type: 'coach_session', coachSessionId: id }
      );
    }

    res.json(successResponse(null, 'Message sent'));
  } catch (error) {
    console.error('[Coach] sendCoachMessage error:', error);
    res.status(500).json(errorResponse('Failed to send message', error));
  }
}
