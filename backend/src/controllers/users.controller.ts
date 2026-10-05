// @ts-nocheck
import { getAuth } from 'firebase-admin/auth';
import { Request, Response } from 'express';
import { ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { db, admin } from '../config/firebase';
import { r2Buckets, getR2Client } from '../config/r2';
import { successResponse, errorResponse, getPaginationParams, createAuditLog, getClientIp, serverTimestamp } from '../utils/helpers';
import { NikkahUser } from '../types';

// Flutter never writes a plain `age` field — only `dateOfBirth` (a Firestore
// Timestamp), computing age client-side wherever it's displayed. The admin
// frontend expects `age` directly, so it must be computed here the same way.
function computeAge(dateOfBirth: unknown): number | undefined {
  const dob = (dateOfBirth as FirebaseFirestore.Timestamp | undefined)?.toDate?.();
  if (!dob) return undefined;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

/**
 * Decides whether an FCM push should be sent.
 *
 * Ordinary notices honour the user's Push Notifications toggle. Enforcement
 * notices (`critical`) ignore it: a banned or suspended user CANNOT read the
 * in-app copy — banUser disables their Firebase Auth account and revokes their
 * refresh tokens, and the notifications subcollection requires `isSelf(uid)` to
 * read — so the push is the only channel that can still reach them. Honouring
 * an opt-out there would lock someone out with no explanation at all.
 *
 * Exported for direct unit testing.
 */
export function shouldSendPush(
  prefs: { pushNotifications?: unknown } | null | undefined,
  critical: boolean
): boolean {
  if (critical) return true;
  if (!prefs) return true; // missing doc/field defaults to enabled
  return prefs.pushNotifications !== false;
}

/**
 * Writes an in-app notification and sends a push for an admin-initiated action.
 *
 * Moderation and premium actions previously changed the user document silently:
 * the affected user was never told they had been banned, suspended, or granted
 * premium. The in-app notification always lands (it is the user's inbox); the
 * FCM push honours the user's preference unless the notice is `critical` — see
 * shouldSendPush.
 *
 * Never throws — a notification failure must not roll back the moderation
 * action itself.
 */
export async function notifyUser(
  uid: string,
  title: string,
  body: string,
  type: string,
  options: { critical?: boolean; relatedId?: string } = {}
): Promise<void> {
  try {
    const notifRef = db.collection('users').doc(uid).collection('notifications').doc();
    await notifRef.set({
      id: notifRef.id,
      title,
      body,
      type,
      isRead: false,
      createdAt: serverTimestamp(),
      ...(options.relatedId && { relatedId: options.relatedId }),
    });

    const settingsDoc = await db
      .collection('users').doc(uid)
      .collection('settings').doc('preferences')
      .get();
    if (!shouldSendPush(settingsDoc.exists ? settingsDoc.data() : null, options.critical === true)) return;

    const userDoc = await db.collection('users').doc(uid).get();
    const data = userDoc.data() || {};
    const tokens: string[] = Array.isArray(data.fcmTokens) ? [...data.fcmTokens] : [];
    if (typeof data.fcmToken === 'string' && data.fcmToken && !tokens.includes(data.fcmToken)) {
      tokens.push(data.fcmToken);
    }
    if (tokens.length === 0) return;

    // The Flutter tap-handler (push_notification_service.dart) routes off
    // `data.relatedId` (and `data.senderId` for chat) — without relatedId
    // here, a support/bug-report push would arrive but tapping it could
    // never open the specific ticket, only fall through silently.
    await admin.messaging().sendEachForMulticast({
      notification: { title, body },
      data: { type, ...(options.relatedId && { relatedId: options.relatedId }) },
      tokens,
    });
  } catch (err) {
    console.error(`[notifyUser] Failed to notify ${uid}:`, err);
  }
}

export async function getUsers(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit } = getPaginationParams(req.query);
    const { search, filter, sortBy = 'createdAt', sortOrder = 'desc' } = req.query as Record<string, string>;

    let query: FirebaseFirestore.Query = db.collection('users');

    // Apply filters
    if (filter === 'premium') query = query.where('isPremium', '==', true);
    else if (filter === 'banned') query = query.where('isBanned', '==', true);
    else if (filter === 'suspended') query = query.where('isSuspended', '==', true);
    else if (filter === 'pending_photo') query = query.where('photoStatus', '==', 'pending');
    else if (filter === 'pending_verification') query = query.where('verificationStatus', '==', 'pending');

    // Sorting
    query = query.orderBy(sortBy, sortOrder as FirebaseFirestore.OrderByDirection);

    // Total count
    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    // Pagination
    const snapshot = await query.offset((page - 1) * limit).limit(limit).get();

    // email/phoneNumber are relocated off users/{uid} into sensitive_data/{uid}
    // (mirrorContactInfoToSensitiveData, functions/src/index.ts) — the whole
    // point being that no OTHER end user's client can read them anymore. The
    // admin panel is a legitimate, authorized exception (Admin SDK bypasses
    // Firestore rules regardless), so it explicitly re-merges them here.
    const sensitiveDocs = await Promise.all(
      snapshot.docs.map(doc => db.collection('sensitive_data').doc(doc.id).get())
    );
    const sensitiveById = new Map(
      sensitiveDocs.map(d => [d.id, d.exists ? d.data() : null])
    );

    let users = snapshot.docs.map(doc => {
      const data = doc.data();
      const sensitive = sensitiveById.get(doc.id);
      // Flutter writes currentCity, not city (see user_model.dart) — every
      // `.city` read below was always undefined against real documents.
      return {
        uid: doc.id,
        ...data,
        email: data.email ?? sensitive?.email,
        phoneNumber: data.phoneNumber ?? sensitive?.phoneNumber,
        city: data.city || data.currentCity || data.permanentCity || '',
        age: computeAge(data.dateOfBirth),
      };
    }) as NikkahUser[];

    // Client-side search (Firestore doesn't support full-text search natively)
    if (search) {
      const searchLower = search.toLowerCase();
      users = users.filter(u =>
        u.displayName?.toLowerCase().includes(searchLower) ||
        u.email?.toLowerCase().includes(searchLower) ||
        u.city?.toLowerCase().includes(searchLower)
      );
    }

    res.json(successResponse({
      data: users,
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    }));
  } catch (error) {
    console.error('[Users] getUsers error:', error);
    res.status(500).json(errorResponse('Failed to fetch users', error));
  }
}

export async function getUserById(req: Request, res: Response): Promise<void> {
  try {
    const { uid } = req.params as { uid: string };
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) {
      res.status(404).json(errorResponse('User not found'));
      return;
    }
    const data = doc.data()!;
    const sensitive = await db.collection('sensitive_data').doc(uid).get();
    res.json(successResponse({
      uid: doc.id,
      ...data,
      email: data.email ?? sensitive.data()?.email,
      phoneNumber: data.phoneNumber ?? sensitive.data()?.phoneNumber,
      city: data.city || data.currentCity || data.permanentCity || '',
      age: computeAge(data.dateOfBirth),
    }));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch user', error));
  }
}

export async function banUser(req: Request, res: Response): Promise<void> {
  try {
    const { uid } = req.params as { uid: string };
    const { reason } = req.body;

    await db.collection('users').doc(uid).update({
      isBanned: true,
      banReason: reason || 'Violated community guidelines',
      bannedAt: serverTimestamp(),
      bannedBy: req.admin!.uid,
    });

    await createAuditLog({
      adminId: req.admin!.uid,
      adminEmail: req.admin!.email,
      action: 'BAN_USER',
      targetId: uid,
      targetType: 'user',
      details: { reason },
      timestamp: new Date(),
      ip: getClientIp(req),
    });

    // Also disable in Firebase Auth and force any already-open session to
    // re-authenticate on its next token refresh (disabling alone only blocks
    // brand-new sign-ins, not a session that's already holding a valid token).
    try {
      await getAuth().updateUser(uid, { disabled: true });
      await getAuth().revokeRefreshTokens(uid);
    } catch { /* User might not have Firebase Auth account */ }

    await notifyUser(
      uid,
      'Account Banned',
      `Your account has been banned. Reason: ${reason || 'Violated community guidelines'}`,
      'account_banned',
      { critical: true }
    );

    res.json(successResponse(null, 'User banned successfully'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to ban user', error));
  }
}

// Lift a suspension early. A suspension otherwise self-heals only when
// suspendedUntil passes (assertAccountInGoodStanding in the Cloud Functions),
// so without this an admin can't reinstate a user ahead of time.
export async function unsuspendUser(req: Request, res: Response): Promise<void> {
  try {
    const { uid } = req.params as { uid: string };
    await db.collection('users').doc(uid).update({
      isSuspended: false,
      suspendedUntil: null,
      banReason: null,
      suspensionExpiredAt: serverTimestamp(),
    });

    await createAuditLog({
      adminId: req.admin!.uid,
      adminEmail: req.admin!.email,
      action: 'UNSUSPEND_USER',
      targetId: uid,
      targetType: 'user',
      details: {},
      timestamp: new Date(),
      ip: getClientIp(req),
    });

    await notifyUser(
      uid,
      'Suspension Lifted',
      'Your account suspension has been lifted. Welcome back.',
      'account_unbanned',
      { critical: true }
    );

    res.json(successResponse(null, 'User suspension lifted'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to lift suspension', error));
  }
}

export async function unbanUser(req: Request, res: Response): Promise<void> {
  try {
    const { uid } = req.params as { uid: string };
    await db.collection('users').doc(uid).update({
      isBanned: false,
      banReason: null,
      bannedAt: null,
      bannedBy: null,
    });
    try {
      await getAuth().updateUser(uid, { disabled: false });
    } catch { /* ignore */ }

    await createAuditLog({
      adminId: req.admin!.uid,
      adminEmail: req.admin!.email,
      action: 'UNBAN_USER',
      targetId: uid,
      targetType: 'user',
      details: {},
      timestamp: new Date(),
      ip: getClientIp(req),
    });

    await notifyUser(
      uid,
      'Account Restored',
      'Your account has been reinstated. Welcome back.',
      'account_unbanned',
      { critical: true }
    );

    res.json(successResponse(null, 'User unbanned successfully'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to unban user', error));
  }
}

export async function suspendUser(req: Request, res: Response): Promise<void> {
  try {
    const { uid } = req.params as { uid: string };
    const { reason, days = 7 } = req.body;
    // Validate the suspension length: a bad/huge/negative value would set a
    // nonsense suspendedUntil (e.g. NaN → Invalid Date, or a 50-year ban).
    const suspendDays = Number(days);
    if (!Number.isFinite(suspendDays) || suspendDays < 1 || suspendDays > 365) {
      res.status(400).json(errorResponse('Suspension length must be between 1 and 365 days.'));
      return;
    }
    const suspendedUntil = new Date();
    suspendedUntil.setDate(suspendedUntil.getDate() + suspendDays);

    await db.collection('users').doc(uid).update({
      isSuspended: true,
      banReason: reason,
      suspendedUntil: suspendedUntil,
    });

    try {
      await getAuth().revokeRefreshTokens(uid);
    } catch { /* User might not have Firebase Auth account */ }

    await createAuditLog({
      adminId: req.admin!.uid,
      adminEmail: req.admin!.email,
      action: 'SUSPEND_USER',
      targetId: uid,
      targetType: 'user',
      details: { reason, days, suspendedUntil: suspendedUntil.toISOString() },
      timestamp: new Date(),
      ip: getClientIp(req),
    });

    await notifyUser(
      uid,
      'Account Suspended',
      `Your account has been suspended for ${days} days. Reason: ${reason || 'Violation of community rules'}`,
      'account_suspended',
      { critical: true }
    );

    res.json(successResponse(null, `User suspended for ${days} days`));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to suspend user', error));
  }
}

/**
 * Permanently and irreversibly deletes a user account: Firebase Auth record,
 * the `users/{uid}` document and its subcollections, every other Firestore
 * collection that references the uid (connections, interests, match
 * requests, matches, chats + messages, notifications, verification data,
 * etc.), and every R2 object under `users/{uid}/` across all seven media
 * buckets. Mirrors (and extends — see the gaps noted inline) the self-service
 * cascade in functions/src/index.ts's deleteMyAccount, re-implemented here
 * rather than called cross-service because this backend already holds full
 * Firebase Admin + R2 credentials and the admin console has its own
 * independent auth/permission system (a Firebase ID token from the deleted
 * user's own session is never involved, so there's no cross-service auth
 * bridge to build).
 *
 * `transactions` and `payment_history` are deliberately NOT deleted — kept
 * as a financial audit trail, matching the documented, tested policy for
 * self-service deletion (security_tests/deletion.test.js, DEL-33).
 *
 * Every step is independently try/caught so one failing collection can't
 * abort the rest of the cascade (a partial failure is recorded in the
 * returned/audited report rather than left silent or fatal). The route
 * itself (`DELETE /api/users/:uid`) is only reachable behind this backend's
 * own `authenticate` + `requirePermission('users.manage')` middleware — a
 * normal app user has no path to it at all (separate service, separate auth
 * scheme from the Flutter app's Firebase ID tokens).
 */
export async function deleteUser(req: Request, res: Response): Promise<void> {
  const { uid } = req.params as { uid: string };
  const step: Record<string, string> = {};

  // Explicit confirmation payload required server-side too, not just a UI
  // dialog — mirrors deleteMyAccount's `confirm: "DELETE"` gate so a
  // mis-wired button or blind retry on the admin console can't trigger this.
  if (req.body?.confirm !== 'DELETE') {
    res.status(400).json(errorResponse('Deletion requires { confirm: "DELETE" } in the request body.'));
    return;
  }

  try {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json(errorResponse('User not found'));
      return;
    }
    const userData = userSnap.data() || {};

    const deleteSnapshot = async (snap: FirebaseFirestore.QuerySnapshot, label: string) => {
      if (snap.empty) { step[label] = 'deleted 0'; return; }
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = db.batch();
        snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      step[label] = `deleted ${snap.size}`;
    };

    const deleteWhere = async (collection: string, field: string, label?: string) => {
      const l = label ?? `${collection}.${field}`;
      try {
        const snap = await db.collection(collection).where(field, '==', uid).get();
        await deleteSnapshot(snap, l);
      } catch (err: any) {
        step[l] = `FAILED: ${err?.message || err}`;
      }
    };

    // ── Documents keyed by the uid itself ──────────────────────────────────
    for (const col of [
      'private_preferences', 'user_preferences', 'sensitive_data',
      'compatibility_assessments', 'verification_center',
    ]) {
      try {
        const ref = db.collection(col).doc(uid);
        if ((await ref.get()).exists) {
          await ref.delete();
          step[col] = 'deleted';
        } else {
          step[col] = 'not present';
        }
      } catch (err: any) {
        step[col] = `FAILED: ${err?.message || err}`;
      }
    }

    // ── Documents referencing the uid in a field ───────────────────────────
    await deleteWhere('blocks', 'blockerId', 'blocks_as_blocker');
    await deleteWhere('blocks', 'blockedId', 'blocks_as_blocked');
    await deleteWhere('user_passes', 'userId');
    await deleteWhere('user_interests', 'senderId', 'interests_sent');
    await deleteWhere('user_interests', 'receiverId', 'interests_received');
    await deleteWhere('connection_requests', 'senderId', 'connection_requests_sent');
    await deleteWhere('connection_requests', 'receiverId', 'connection_requests_received');
    await deleteWhere('profile_view_requests', 'senderId', 'profile_view_requests_sent');
    await deleteWhere('profile_view_requests', 'receiverId', 'profile_view_requests_received');
    await deleteWhere('matches', 'userA', 'matches_a');
    await deleteWhere('matches', 'userB', 'matches_b');
    await deleteWhere('matching_scores', 'userA', 'matching_scores_a');
    await deleteWhere('matching_scores', 'userB', 'matching_scores_b');
    await deleteWhere('spiritual_compatibility', 'userA', 'spiritual_compatibility_a');
    await deleteWhere('spiritual_compatibility', 'userB', 'spiritual_compatibility_b');
    await deleteWhere('rishta_diary', 'userId');
    await deleteWhere('activity_logs', 'userId');
    await deleteWhere('verification_requests', 'userId');
    await deleteWhere('profile_visibility', 'ownerId', 'profile_visibility_owner');
    await deleteWhere('profile_visibility', 'viewerId', 'profile_visibility_viewer');
    await deleteWhere('chaperone_access', 'ownerId', 'chaperone_access_owner');
    await deleteWhere('chaperone_access', 'chaperoneId', 'chaperone_access_chaperone');
    // Written as `chaperoneId` (functions/src/index.ts submitChaperoneFlag) —
    // NOT `flaggedBy`, which is what deleteMyAccount's query mistakenly
    // filters on today (a pre-existing bug there, left as-is in this pass
    // since it's outside the admin-deletion scope; using the correct field
    // name here so this routine doesn't repeat the same miss).
    await deleteWhere('chaperone_flags', 'chaperoneId');
    await deleteWhere('reports', 'reporterId', 'reports_filed');
    await deleteWhere('reports', 'reportedUserId', 'reports_against');
    await deleteWhere('chat_members', 'userId');
    await deleteWhere('unread_counts', 'userId');
    await deleteWhere('typing_status', 'userId');
    await deleteWhere('coach_sessions', 'userId');
    await deleteWhere('human_verification_bookings', 'userId');
    await deleteWhere('invitations', 'senderId');

    // ── family_accounts: shared between a guardian (ownerId) and the
    // candidate they linked (candidateId) — deleting the whole doc when the
    // CANDIDATE leaves would destroy the guardian's still-valid record, so
    // only the candidate reference is cleared in that case.
    try {
      const asOwner = await db.collection('family_accounts').where('ownerId', '==', uid).get();
      await deleteSnapshot(asOwner, 'family_accounts_as_owner');
      const asCandidate = await db.collection('family_accounts').where('candidateId', '==', uid).get();
      for (const doc of asCandidate.docs) {
        await doc.ref.update({
          candidateId: admin.firestore.FieldValue.delete(),
          candidateRemovedAt: serverTimestamp(),
          candidateRemovedReason: 'account_deleted',
        });
      }
      step['family_accounts_as_candidate'] = `cleared ${asCandidate.size}`;
    } catch (err: any) {
      step['family_accounts'] = `FAILED: ${err?.message || err}`;
    }

    // ── family_chat_rooms: shared `participants` array — remove just this
    // uid so a room with other members still active survives.
    try {
      const rooms = await db.collection('family_chat_rooms').where('participants', 'array-contains', uid).get();
      let roomsDeleted = 0;
      let roomsUpdated = 0;
      for (const room of rooms.docs) {
        const participants = (room.data().participants || []) as string[];
        if (participants.filter((p) => p !== uid).length === 0) {
          await room.ref.delete();
          roomsDeleted++;
        } else {
          await room.ref.update({ participants: admin.firestore.FieldValue.arrayRemove(uid) });
          roomsUpdated++;
        }
      }
      step['family_chat_rooms'] = `deleted ${roomsDeleted}, updated ${roomsUpdated}`;
    } catch (err: any) {
      step['family_chat_rooms'] = `FAILED: ${err?.message || err}`;
    }

    // ── Support tickets (+ message subcollection + tied activity log) ──────
    try {
      const tickets = await db.collection('support_tickets').where('userId', '==', uid).get();
      let msgCount = 0;
      for (const t of tickets.docs) {
        const msgs = await t.ref.collection('messages').get();
        msgCount += msgs.size;
        await deleteSnapshot(msgs, `support_messages_${t.id}`);
        const activity = await db.collection('ticket_activity').where('ticketId', '==', t.id).get();
        await deleteSnapshot(activity, `ticket_activity_${t.id}`);
        await t.ref.delete();
      }
      step['support_tickets'] = `deleted ${tickets.size} (${msgCount} messages)`;
    } catch (err: any) {
      step['support_tickets'] = `FAILED: ${err?.message || err}`;
    }

    // ── Chats the user participates in, with their messages ────────────────
    try {
      const chats = await db.collection('chats').where('participants', 'array-contains', uid).get();
      let messageCount = 0;
      for (const c of chats.docs) {
        const msgs = await c.ref.collection('messages').get();
        messageCount += msgs.size;
        await deleteSnapshot(msgs, `chat_messages_${c.id}`);
        await c.ref.delete();
      }
      step['chats'] = `deleted ${chats.size} (${messageCount} messages)`;
    } catch (err: any) {
      step['chats'] = `FAILED: ${err?.message || err}`;
    }

    // ── discover_feed_cache/{uid}/profiles/* ───────────────────────────────
    try {
      const cached = await db.collection('discover_feed_cache').doc(uid).collection('profiles').get();
      await deleteSnapshot(cached, 'discover_feed_cache');
      await db.collection('discover_feed_cache').doc(uid).delete().catch(() => undefined);
    } catch (err: any) {
      step['discover_feed_cache'] = `FAILED: ${err?.message || err}`;
    }

    // ── users/{uid} subcollections (notifications, settings, favorites,
    // quiz_draft, ...) then the document itself ────────────────────────────
    try {
      const subcollections = await userRef.listCollections();
      for (const sub of subcollections) {
        const snap = await sub.get();
        await deleteSnapshot(snap, `users_sub_${sub.id}`);
      }
    } catch (err: any) {
      step['users_subcollections'] = `FAILED: ${err?.message || err}`;
    }

    // ── R2 objects under users/{uid}/ across every media bucket ────────────
    try {
      const s3 = getR2Client();
      let objectsDeleted = 0;
      if (s3) {
        for (const key of Object.keys(r2Buckets) as (keyof typeof r2Buckets)[]) {
          const bucketName = r2Buckets[key].bucket;
          if (!bucketName) continue;
          try {
            let token: string | undefined;
            do {
              const listed: any = await s3.send(new ListObjectsV2Command({
                Bucket: bucketName,
                Prefix: `users/${uid}/`,
                ContinuationToken: token,
              }));
              for (const obj of listed.Contents ?? []) {
                if (!obj.Key) continue;
                await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: obj.Key }));
                objectsDeleted++;
              }
              token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
            } while (token);
          } catch (err: any) {
            step[`r2_${key}`] = `FAILED: ${err?.message || err}`;
          }
        }
      } else {
        step['r2_objects'] = 'SKIPPED: R2 client not configured';
      }
      step['r2_objects'] = step['r2_objects'] ?? `deleted ${objectsDeleted}`;
    } catch (err: any) {
      step['r2_objects'] = `FAILED: ${err?.message || err}`;
    }

    // ── The users/{uid} document itself ─────────────────────────────────────
    await userRef.delete();
    step['user_document'] = 'deleted';

    // ── Firebase Auth record (last, so any failure above still leaves a
    // usable account rather than an orphaned Auth entry with no data) ──────
    try {
      await getAuth().deleteUser(uid);
      step['firebase_auth'] = 'deleted';
    } catch (err: any) {
      step['firebase_auth'] = `FAILED or already absent: ${err?.message || err}`;
    }

    await createAuditLog({
      adminId: req.admin!.uid,
      adminEmail: req.admin!.email,
      action: 'DELETE_USER',
      targetId: uid,
      targetType: 'user',
      details: {
        deletedDisplayName: userData.displayName ?? null,
        deletedUsername: userData.username ?? null,
        deletedEmail: userData.email ?? null,
        report: step,
      },
      timestamp: new Date(),
      ip: getClientIp(req),
    });

    res.json(successResponse({ report: step }, 'User deleted successfully'));
  } catch (error: any) {
    // Log the attempt even when the top-level flow throws, so the partial
    // cascade (whatever made it into `step` before the throw) isn't lost.
    try {
      await createAuditLog({
        adminId: req.admin?.uid || 'unknown',
        adminEmail: req.admin?.email || 'unknown',
        action: 'DELETE_USER_FAILED',
        targetId: uid,
        targetType: 'user',
        details: { error: error?.message || String(error), partialReport: step },
        timestamp: new Date(),
        ip: getClientIp(req),
      });
    } catch { /* audit log itself failing must not mask the original error */ }
    res.status(500).json(errorResponse('Failed to delete user', error));
  }
}

export async function grantPremium(req: Request, res: Response): Promise<void> {
  try {
    const { uid } = req.params as { uid: string };
    const { expiresInDays = 30 } = req.body;
    const grantDays = Number(expiresInDays);
    if (!Number.isFinite(grantDays) || grantDays < 1 || grantDays > 3650) {
      res.status(400).json(errorResponse('Premium length must be between 1 and 3650 days.'));
      return;
    }
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + grantDays);

    await db.collection('users').doc(uid).update({
      isPremium: true,
      premiumGrantedBy: req.admin!.uid,
      premiumGrantedAt: serverTimestamp(),
      // Canonical field read by the Flutter app, getDiscoveryFeed and
      // checkSubscriptionCron. This previously wrote `premiumExpiresAt`, which
      // nothing else in the codebase reads — so an admin-granted subscription
      // never showed an expiry and was never picked up by the expiry cron.
      premiumExpiryDate: expiresAt,
      premiumGracePeriodExpiry: null,
    });

    await createAuditLog({
      adminId: req.admin!.uid,
      adminEmail: req.admin!.email,
      action: 'GRANT_PREMIUM',
      targetId: uid,
      targetType: 'user',
      details: { expiresInDays: grantDays },
      timestamp: new Date(),
      ip: getClientIp(req),
    });

    await notifyUser(
      uid,
      'Premium Activated',
      `You have been granted ${grantDays} days of Premium access. Enjoy!`,
      'premium_granted'
    );

    res.json(successResponse(null, `Premium granted for ${grantDays} days`));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to grant premium', error));
  }
}

export async function revokePremium(req: Request, res: Response): Promise<void> {
  try {
    const { uid } = req.params as { uid: string };
    await db.collection('users').doc(uid).update({
      isPremium: false,
      premiumExpiryDate: null,
      premiumGracePeriodExpiry: null,
    });

    await createAuditLog({
      adminId: req.admin!.uid,
      adminEmail: req.admin!.email,
      action: 'REVOKE_PREMIUM',
      targetId: uid,
      targetType: 'user',
      details: {},
      timestamp: new Date(),
      ip: getClientIp(req),
    });

    res.json(successResponse(null, 'Premium revoked'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to revoke premium', error));
  }
}

