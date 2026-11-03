import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  successResponse, errorResponse, createAuditLog, getClientIp, getPaginationParams,
} from '../utils/helpers';

/**
 * Family & Wali management — admin views over the SAME collections the app
 * uses (functions/src/family/familyLinks.ts): family_groups, family_links,
 * chaperone_access, and the users' marital/polygamy preference fields.
 *
 * Privacy rules this controller follows on purpose:
 *  - It never reads chats/{id}/messages or sensitive_data/* — admins see who
 *    is linked to whom and which permissions are ON, never the shared data
 *    or private conversations.
 *  - It never returns CNIC, financial or verification media fields.
 *  - Admins can only REVOKE or SUSPEND. Nothing here can create a link or
 *    grant access — that always needs the user's own acceptance in the app.
 *  - Every write is audited in admin_audit_logs.
 */

const LINK_KINDS = ['group', 'access', 'candidate'] as const;
const MAX_SCAN = 2000;

function ms(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
}

function matches(search: string, ...fields: unknown[]): boolean {
  if (!search) return true;
  return fields.some((f) => String(f ?? '').toLowerCase().includes(search));
}

function paginate<T>(items: T[], query: Request['query']) {
  const { page, limit } = getPaginationParams(query);
  const start = (page - 1) * limit;
  return { items: items.slice(start, start + limit), total: items.length, page, limit };
}

function reasonOf(req: Request): string {
  return String((req.body as Record<string, unknown>)?.reason ?? '').trim().slice(0, 500);
}

async function audit(req: Request, action: string, targetId: string, details: Record<string, unknown>) {
  await createAuditLog({
    adminId: req.admin!.uid,
    adminEmail: req.admin!.email,
    action,
    targetId,
    targetType: 'family',
    details,
    timestamp: new Date(),
    ip: getClientIp(req),
  });
}

/** Tell the affected users what happened (transparency — no data exposed). */
async function notifyUsers(uids: string[], title: string, body: string) {
  await Promise.all(
    [...new Set(uids.filter(Boolean))].map((uid) =>
      db.collection('users').doc(uid).collection('notifications').add({
        title, body, type: 'system_alert', isRead: false,
        timestamp: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
      }).catch(() => undefined),
    ),
  );
}

/** Admin-facing status bucket for a family link. */
function linkStatus(d: FirebaseFirestore.DocumentData, suspendedGroups: Set<string>): string {
  if (d.kind === 'group' && d.groupId && suspendedGroups.has(d.groupId) && d.status === 'accepted') return 'suspended';
  switch (d.status) {
    case 'accepted': return 'active';
    case 'declined': return 'rejected';
    case 'removed': return 'removed';
    case 'revoked': return 'revoked';
    default: return 'pending';
  }
}

function chaperoneStatus(s: string): string {
  switch (s) {
    case 'active': return 'active';
    case 'declined': return 'rejected';
    case 'ended': return 'ended';
    case 'revoked': return 'revoked';
    default: return 'pending';
  }
}

function statusFilter(query: Request['query']): string {
  const s = String(query.status ?? 'all').toLowerCase();
  return s === 'accepted' ? 'active' : s;
}

async function suspendedGroupIds(): Promise<Set<string>> {
  const snap = await db.collection('family_groups').where('suspended', '==', true).get();
  return new Set(snap.docs.map((d) => d.id));
}


function inRemarriagePool(u: FirebaseFirestore.DocumentData): boolean {
  if (u.previouslyMarried === true) return true;
  const st = String(u.maritalStatus ?? '').toLowerCase();
  return ['divorc', 'widow', 'separated', 'khula'].some((k) => st.includes(k));
}

function disclosed(u: FirebaseFirestore.DocumentData): boolean {
  return String(u.currentMarriageDeclaration ?? '').trim().length >= 10;
}

/** Mirrors functions/src/family/familyLinks.ts syncManagedByFamily. */
async function syncManagedByFamily(candidateId: string): Promise<void> {
  if (!candidateId) return;
  const [links, accounts] = await Promise.all([
    db.collection('family_links').where('principalId', '==', candidateId).get(),
    db.collection('family_accounts').where('candidateId', '==', candidateId).get(),
  ]);
  const managerIds = links.docs.map((x) => x.data())
    .filter((l) => l.kind === 'candidate' && l.status === 'accepted').map((l) => l.memberId as string);
  const claimed = accounts.docs.some((x) => x.data().status === 'claimed');
  await db.collection('users').doc(candidateId).set(
    { managedByFamily: managerIds.length > 0 || claimed, familyManagerIds: managerIds }, { merge: true });
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function getFamilyStats(_req: Request, res: Response): Promise<void> {
  try {
    const count = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;
    const links = db.collection('family_links');
    const chap = db.collection('chaperone_access');
    const users = db.collection('users');

    const linkStats: Record<string, Record<string, number>> = {};
    await Promise.all(LINK_KINDS.map(async (kind) => {
      const [pending, accepted, declined, removed, revoked] = await Promise.all(
        ['pending', 'accepted', 'declined', 'removed', 'revoked'].map((st) =>
          count(links.where('kind', '==', kind).where('status', '==', st))),
      );
      linkStats[kind] = { pending, active: accepted, rejected: declined, removed, revoked };
    }));

    const [groupsTotal, groupsSuspended, chPending, chActive, chDeclined, chEnded, chRevoked,
      polySeekers, openPoly, remarriagePool, openRemarriage, previouslyMarried, flagsOpen] = await Promise.all([
      count(db.collection('family_groups')),
      count(db.collection('family_groups').where('suspended', '==', true)),
      count(chap.where('status', '==', 'pending')),
      count(chap.where('status', '==', 'active')),
      count(chap.where('status', '==', 'declined')),
      count(chap.where('status', '==', 'ended')),
      count(chap.where('status', '==', 'revoked')),
      count(users.where('isPolygamySeeker', '==', true)),
      count(users.where('openToPolygamy', '==', true)),
      count(users.where('remarriageMatchingPool', '==', true)),
      count(users.where('openToRemarriage', '==', true)),
      count(users.where('previouslyMarried', '==', true)),
      count(db.collection('chaperone_flags').where('status', '==', 'flagged')),
    ]);
    const [roomsActive, roomsTotal, chReadWrite] = await Promise.all([
      count(db.collection('family_chat_rooms').where('active', '==', true)),
      count(db.collection('family_chat_rooms')),
      count(chap.where('canWrite', '==', true)),
    ]);

    res.json(successResponse({
      groups: { total: groupsTotal, suspended: groupsSuspended, active: groupsTotal - groupsSuspended },
      access: linkStats.access,
      candidates: linkStats.candidate,
      groupInvites: linkStats.group,
      chaperones: { pending: chPending, active: chActive, rejected: chDeclined, ended: chEnded, revoked: chRevoked },
      marital: { polySeekers, openPoly, remarriagePool, openRemarriage, previouslyMarried },
      chaperoneReportsOpen: flagsOpen,
      rooms: { active: roomsActive, total: roomsTotal },
      chaperoneReadWrite: chReadWrite,
    }));
  } catch (error) {
    console.error('[FamilyAdmin] stats error:', error);
    res.status(500).json(errorResponse('Failed to load family statistics'));
  }
}

// ─── Family Groups ───────────────────────────────────────────────────────────

export async function listFamilyGroups(req: Request, res: Response): Promise<void> {
  try {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const status = statusFilter(req.query);
    const snap = await db.collection('family_groups').limit(MAX_SCAN).get();
    const items = snap.docs.map((d) => {
      const g = d.data();
      const names = (g.memberNames ?? {}) as Record<string, string>;
      return {
        id: d.id,
        name: g.name ?? 'Family',
        ownerId: g.ownerId,
        ownerName: g.ownerName ?? 'Member',
        memberCount: ((g.memberIds ?? []) as string[]).length,
        memberNames: Object.values(names),
        status: g.suspended === true ? 'suspended' : 'active',
        suspendedReason: g.suspendedReason ?? null,
        createdAtMs: ms(g.createdAt),
      };
    })
      .filter((g) => status === 'all' || g.status === status)
      .filter((g) => matches(search, g.name, g.ownerName, g.ownerId, ...g.memberNames))
      .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
    res.json(successResponse(paginate(items, req.query)));
  } catch (error) {
    console.error('[FamilyAdmin] groups error:', error);
    res.status(500).json(errorResponse('Failed to load family groups'));
  }
}

export async function getFamilyGroupDetail(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const doc = await db.collection('family_groups').doc(id).get();
    if (!doc.exists) { res.status(404).json(errorResponse('Group not found')); return; }
    const g = doc.data()!;
    const names = (g.memberNames ?? {}) as Record<string, string>;
    const history = await db.collection('family_links').where('groupId', '==', id).get();
    res.json(successResponse({
      id,
      name: g.name,
      ownerId: g.ownerId,
      ownerName: g.ownerName,
      status: g.suspended === true ? 'suspended' : 'active',
      suspendedReason: g.suspendedReason ?? null,
      members: ((g.memberIds ?? []) as string[]).map((uid) => ({
        uid, name: names[uid] ?? 'Member', isOwner: uid === g.ownerId,
      })),
      invitations: history.docs.map((l) => {
        const d = l.data();
        return {
          id: l.id,
          inviteeId: d.inviteeId,
          inviteeName: d.inviteeName,
          status: linkStatus(d, new Set(g.suspended ? [id] : [])),
          createdAtMs: ms(d.createdAt),
          respondedAtMs: ms(d.respondedAt),
        };
      }).sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0)),
    }));
  } catch (error) {
    console.error('[FamilyAdmin] group detail error:', error);
    res.status(500).json(errorResponse('Failed to load group'));
  }
}

export async function setFamilyGroupSuspended(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const suspend = req.path.endsWith('/suspend');
    const reason = reasonOf(req);
    if (suspend && !reason) { res.status(400).json(errorResponse('A reason is required to suspend a group')); return; }
    const ref = db.collection('family_groups').doc(id);
    const doc = await ref.get();
    if (!doc.exists) { res.status(404).json(errorResponse('Group not found')); return; }

    await ref.update(suspend
      ? { suspended: true, suspendedReason: reason, suspendedBy: req.admin!.uid, suspendedAt: FieldValue.serverTimestamp() }
      : { suspended: false, suspendedReason: FieldValue.delete(), unsuspendedBy: req.admin!.uid, unsuspendedAt: FieldValue.serverTimestamp() });

    await audit(req, suspend ? 'SUSPEND_FAMILY_GROUP' : 'UNSUSPEND_FAMILY_GROUP', id, { reason, groupName: doc.data()?.name });
    await notifyUsers((doc.data()?.memberIds ?? []) as string[],
      suspend ? 'Family group suspended' : 'Family group restored',
      suspend
        ? `The family group "${doc.data()?.name ?? 'Family'}" was suspended by our team for review.`
        : `The family group "${doc.data()?.name ?? 'Family'}" is active again.`);
    res.json(successResponse(null, suspend ? 'Group suspended' : 'Group restored'));
  } catch (error) {
    console.error('[FamilyAdmin] suspend error:', error);
    res.status(500).json(errorResponse('Failed to update group'));
  }
}

// ─── Family links (Family/Wali Access, Candidates, group invites) ───────────

export async function listFamilyLinks(req: Request, res: Response): Promise<void> {
  try {
    const kind = String(req.query.kind ?? 'access');
    if (!LINK_KINDS.includes(kind as typeof LINK_KINDS[number])) {
      res.status(400).json(errorResponse('Unknown link kind')); return;
    }
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const status = statusFilter(req.query);
    const suspended = kind === 'group' ? await suspendedGroupIds() : new Set<string>();
    const snap = await db.collection('family_links').where('kind', '==', kind).limit(MAX_SCAN).get();
    const items = snap.docs.map((l) => {
      const d = l.data();
      const perms = (d.permissions ?? {}) as Record<string, boolean>;
      return {
        id: l.id,
        kind: d.kind,
        role: d.role,
        status: linkStatus(d, suspended),
        rawStatus: d.status,
        inviterId: d.inviterId,
        inviterName: d.inviterName,
        inviteeId: d.inviteeId,
        inviteeName: d.inviteeName,
        principalId: d.principalId,
        memberId: d.memberId,
        groupId: d.groupId ?? null,
        // Only WHICH permissions are on — never the shared data itself.
        permissions: {
          profile: perms.profile === true,
          preferences: perms.preferences === true,
          contact: perms.contact === true,
          editBasics: perms.editBasics === true,
        },
        consent: d.status === 'accepted' ? 'given' : d.status === 'declined' ? 'refused' : d.status === 'pending' ? 'awaiting' : 'withdrawn',
        createdAtMs: ms(d.createdAt),
        respondedAtMs: ms(d.respondedAt),
        endedAtMs: ms(d.revokedAt ?? d.removedAt),
        revokeReason: d.revokeReason ?? null,
      };
    })
      .filter((l) => status === 'all' || l.status === status || (status === 'revoked' && l.status === 'removed'))
      .filter((l) => matches(search, l.inviterName, l.inviteeName, l.inviterId, l.inviteeId, l.role, l.id))
      .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
    res.json(successResponse(paginate(items, req.query)));
  } catch (error) {
    console.error('[FamilyAdmin] links error:', error);
    res.status(500).json(errorResponse('Failed to load family links'));
  }
}

export async function revokeFamilyLink(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const reason = reasonOf(req);
    if (!reason) { res.status(400).json(errorResponse('A reason is required to revoke access')); return; }
    const ref = db.collection('family_links').doc(id);
    const doc = await ref.get();
    if (!doc.exists) { res.status(404).json(errorResponse('Link not found')); return; }
    const d = doc.data()!;
    if (d.status === 'revoked' || d.status === 'removed') {
      res.status(400).json(errorResponse('This link is already ended')); return;
    }

    const batch = db.batch();
    batch.update(ref, {
      status: 'revoked', revokedByAdmin: req.admin!.uid, revokeReason: reason, revokedAt: FieldValue.serverTimestamp(),
    });
    if (d.kind === 'group' && d.status === 'accepted' && d.groupId) {
      batch.update(db.collection('family_groups').doc(d.groupId), {
        memberIds: FieldValue.arrayRemove(d.memberId),
        [`memberNames.${d.memberId}`]: FieldValue.delete(),
      });
    }
    let chaperonesEnded = 0;
    if (d.kind === 'access') {
      const chaps = await db.collection('chaperone_access').where('linkId', '==', id).get();
      for (const c of chaps.docs) {
        const cd = c.data();
        if (cd.status === 'active') {
          batch.update(db.collection('chats').doc(cd.chatId), { chaperoneIds: FieldValue.arrayRemove(cd.chaperoneId) });
        }
        if (cd.status === 'active' || cd.status === 'pending') {
          batch.update(c.ref, { status: 'revoked', revokedByAdmin: req.admin!.uid, revokedAt: FieldValue.serverTimestamp() });
          chaperonesEnded++;
        }
      }
    }
    await batch.commit();
    if (d.kind === 'candidate') await syncManagedByFamily(d.principalId);

    await audit(req, 'REVOKE_FAMILY_LINK', id, {
      reason, kind: d.kind, role: d.role, previousStatus: d.status,
      inviterId: d.inviterId, inviteeId: d.inviteeId, chaperonesEnded,
    });
    await notifyUsers([d.inviterId, d.inviteeId], 'Family access removed',
      'An administrator removed a family / wali link on your account for safety reasons.');
    res.json(successResponse({ chaperonesEnded }, 'Access revoked'));
  } catch (error) {
    console.error('[FamilyAdmin] revoke link error:', error);
    res.status(500).json(errorResponse('Failed to revoke access'));
  }
}

// ─── Chaperone / Wali in chats ───────────────────────────────────────────────

export async function listChaperones(req: Request, res: Response): Promise<void> {
  try {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const status = statusFilter(req.query);
    const snap = await db.collection('chaperone_access').limit(MAX_SCAN).get();
    const items = snap.docs
      .filter((c) => c.data().participantIds) // skip legacy docs from the old chaperone flow
      .map((c) => {
        const d = c.data();
        return {
          id: c.id,
          chatId: d.chatId, // id only — admins never get the messages from here
          role: d.role,
          status: chaperoneStatus(d.status),
          ownerId: d.ownerId, ownerName: d.ownerName,
          partnerId: d.partnerId, partnerName: d.partnerName,
          chaperoneId: d.chaperoneId, chaperoneName: d.chaperoneName,
          // Consent: requester asked; the partner must approve.
          ownerConsent: true,
          partnerConsent: d.status === 'active' ? 'approved' : d.status === 'declined' ? 'declined' : d.status === 'pending' ? 'awaiting' : 'n/a',
          // Wali Chat Permission: Read Only unless BOTH participants allowed writing.
          permission: d.canWrite === true ? 'read_write' : 'read_only',
          ownerAllowsWrite: d.writeApprovals?.[d.ownerId] === true,
          partnerAllowsWrite: d.writeApprovals?.[d.partnerId] === true,
          createdAtMs: ms(d.createdAt),
          respondedAtMs: ms(d.respondedAt),
          endedAtMs: ms(d.endedAt ?? d.revokedAt),
        };
      })
      .filter((c) => status === 'all' || c.status === status || (status === 'revoked' && c.status === 'ended'))
      .filter((c) => matches(search, c.ownerName, c.partnerName, c.chaperoneName, c.ownerId, c.partnerId, c.chaperoneId))
      .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
    res.json(successResponse(paginate(items, req.query)));
  } catch (error) {
    console.error('[FamilyAdmin] chaperones error:', error);
    res.status(500).json(errorResponse('Failed to load chaperones'));
  }
}

export async function revokeChaperone(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const reason = reasonOf(req);
    if (!reason) { res.status(400).json(errorResponse('A reason is required')); return; }
    const ref = db.collection('chaperone_access').doc(id);
    const doc = await ref.get();
    if (!doc.exists) { res.status(404).json(errorResponse('Not found')); return; }
    const d = doc.data()!;
    if (d.status !== 'active' && d.status !== 'pending') {
      res.status(400).json(errorResponse('This chaperone assignment is already ended')); return;
    }
    const batch = db.batch();
    batch.update(ref, { status: 'revoked', revokedByAdmin: req.admin!.uid, revokeReason: reason, revokedAt: FieldValue.serverTimestamp() });
    if (d.status === 'active') {
      batch.update(db.collection('chats').doc(d.chatId), { chaperoneIds: FieldValue.arrayRemove(d.chaperoneId) });
    }
    await batch.commit();
    await audit(req, 'REVOKE_CHAPERONE', id, {
      reason, chatId: d.chatId, chaperoneId: d.chaperoneId, ownerId: d.ownerId, partnerId: d.partnerId, previousStatus: d.status,
    });
    await notifyUsers([d.ownerId, d.partnerId, d.chaperoneId], 'Chaperone removed',
      'An administrator removed a chaperone from a conversation for safety reasons.');
    res.json(successResponse(null, 'Chaperone removed'));
  } catch (error) {
    console.error('[FamilyAdmin] revoke chaperone error:', error);
    res.status(500).json(errorResponse('Failed to remove chaperone'));
  }
}

// ─── Family Rooms (24h, code based) ─────────────────────────────────────────

function roomStatus(d: FirebaseFirestore.DocumentData): string {
  if (d.closedByAdmin) return 'revoked';
  if (d.endedBy) return 'ended';
  const exp = ms(d.expiresAt) ?? 0;
  return d.active === true && exp > Date.now() ? 'active' : 'expired';
}

/** Room metadata only — never the 6-digit code and never the messages. */
export async function listFamilyRooms(req: Request, res: Response): Promise<void> {
  try {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const status = String(req.query.status ?? 'all').toLowerCase();
    const snap = await db.collection('family_chat_rooms').limit(MAX_SCAN).get();
    const items = snap.docs.map((r) => {
      const d = r.data();
      const parts: string[] = Array.isArray(d.participants) ? d.participants : [];
      return {
        id: r.id,
        chatId: d.chatId ?? null,
        creatorId: d.creatorId ?? null,
        creatorName: d.creatorName ?? 'Member',
        partnerId: parts.find((p) => p !== d.creatorId) ?? null,
        viewerCount: Array.isArray(d.viewerIds) ? d.viewerIds.length : 0,
        status: roomStatus(d),
        createdAtMs: ms(d.createdAt),
        expiresAtMs: ms(d.expiresAt),
        renewedAtMs: ms(d.lastRenewedAt),
      };
    })
      .filter((r) => status === 'all' || r.status === status)
      .filter((r) => matches(search, r.creatorName, r.creatorId, r.partnerId, r.id))
      .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
    res.json(successResponse(paginate(items, req.query)));
  } catch (error) {
    console.error('[FamilyAdmin] rooms error:', error);
    res.status(500).json(errorResponse('Failed to load family rooms'));
  }
}

export async function closeFamilyRoom(req: Request, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const reason = reasonOf(req);
    if (!reason) { res.status(400).json(errorResponse('A reason is required')); return; }
    const ref = db.collection('family_chat_rooms').doc(id);
    const doc = await ref.get();
    if (!doc.exists) { res.status(404).json(errorResponse('Room not found')); return; }
    const d = doc.data()!;
    if (roomStatus(d) !== 'active') { res.status(400).json(errorResponse('This room is not active')); return; }
    await ref.update({
      active: false, endedBy: 'admin:' + req.admin!.uid, closedByAdmin: req.admin!.uid,
      closeReason: reason, endedAt: FieldValue.serverTimestamp(),
    });
    await audit(req, 'CLOSE_FAMILY_ROOM', id, { reason, chatId: d.chatId, creatorId: d.creatorId });
    await notifyUsers([...(d.participants ?? []), ...(d.viewerIds ?? [])], 'Family Room closed',
      'An administrator closed a Family Room for safety reasons.');
    res.json(successResponse(null, 'Room closed'));
  } catch (error) {
    console.error('[FamilyAdmin] close room error:', error);
    res.status(500).json(errorResponse('Failed to close room'));
  }
}

// ─── Remarriage & Polygamy ───────────────────────────────────────────────────

const MARITAL_FLAGS = ['isPolygamySeeker', 'openToPolygamy', 'remarriageMatchingPool', 'openToRemarriage', 'previouslyMarried'] as const;
type MaritalFlag = typeof MARITAL_FLAGS[number];

export async function listMaritalPreferences(req: Request, res: Response): Promise<void> {
  try {
    const filter = String(req.query.filter ?? 'isPolygamySeeker');
    const search = String(req.query.search ?? '').trim().toLowerCase();
    let q: FirebaseFirestore.Query = db.collection('users');
    // 'invalid' = a woman flagged as a polygamy seeker (the flag is men-only).
    if (filter === 'invalid') q = q.where('isPolygamySeeker', '==', true);
    else if (MARITAL_FLAGS.includes(filter as MaritalFlag)) q = q.where(filter, '==', true);
    else { res.status(400).json(errorResponse('Unknown filter')); return; }

    const snap = await q.limit(MAX_SCAN).get();
    const items = snap.docs.map((u) => {
      const d = u.data();
      const gender = String(d.gender ?? '');
      return {
        uid: u.id,
        displayName: d.displayName ?? 'Member',
        username: d.username ?? null,
        gender,
        maritalStatus: d.maritalStatus ?? null,
        openToMaritalStatuses: Array.isArray(d.openToMaritalStatuses) ? d.openToMaritalStatuses : [],
        flags: Object.fromEntries(MARITAL_FLAGS.map((f) => [f, d[f] === true])) as Record<MaritalFlag, boolean>,
        // Same pool rule as functions/src/matching/poolRules.ts.
        pool: inRemarriagePool(d) ? 'remarriage' : 'first_marriage',
        polygamyDisclosed: d.isPolygamySeeker === true ? disclosed(d) : null,
        issue: d.isPolygamySeeker === true && gender.toLowerCase() === 'female'
          ? 'Polygamy-seeker flag set on a female profile'
          : (d.isPolygamySeeker === true && !disclosed(d)
            ? 'Polygamy seeker without current-marriage disclosure (hidden from discovery)'
            : null),
        accountStatus: d.isBanned ? 'banned' : (d.isSuspended ? 'suspended' : 'active'),
      };
    })
      .filter((u) => filter !== 'invalid' || u.issue !== null)
      .filter((u) => matches(search, u.displayName, u.username, u.uid, u.maritalStatus))
      .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
    res.json(successResponse(paginate(items, req.query)));
  } catch (error) {
    console.error('[FamilyAdmin] marital error:', error);
    res.status(500).json(errorResponse('Failed to load marital preferences'));
  }
}

/** Turn OFF one preference flag (e.g. an invalid or abusive setting). Never turns one ON. */
export async function resetMaritalFlag(req: Request, res: Response): Promise<void> {
  try {
    const uid = String(req.params.uid);
    const field = String((req.body as Record<string, unknown>)?.field ?? '') as MaritalFlag;
    const reason = reasonOf(req);
    if (!MARITAL_FLAGS.includes(field)) { res.status(400).json(errorResponse('Unknown field')); return; }
    if (!reason) { res.status(400).json(errorResponse('A reason is required')); return; }
    const ref = db.collection('users').doc(uid);
    const doc = await ref.get();
    if (!doc.exists) { res.status(404).json(errorResponse('User not found')); return; }
    const before = doc.data()?.[field] === true;
    await ref.update({ [field]: false, updatedAt: FieldValue.serverTimestamp() });
    await audit(req, 'RESET_MARITAL_PREFERENCE', uid, { field, before, after: false, reason });
    await notifyUsers([uid], 'Matching preference updated',
      'Our team turned off one of your remarriage / polygamy matching preferences. You can review it in Remarriage & Polygamy settings.');
    res.json(successResponse(null, 'Preference reset'));
  } catch (error) {
    console.error('[FamilyAdmin] reset marital error:', error);
    res.status(500).json(errorResponse('Failed to reset preference'));
  }
}
