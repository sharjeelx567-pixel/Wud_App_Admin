// @ts-nocheck
import { Request, Response } from 'express';
import { db } from '../config/firebase';

// Public, read-only web view of a Family Group Chat Room (COMM-04 "external
// link that works without installing the app"). A parent opens the shared
// link in a browser and follows the conversation; nobody can send messages.
// No login — the 20-character Firestore room id in the link is the access
// token. The 6-digit code still works inside the app.
//
// Same lifecycle as the app: while the room is live (active and not past
// expiresAt) the conversation is shown; once it expires or a participant
// closes it, the page LOCKS and shows no messages (renewing reopens it).

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function page(title: string, body: string, autoRefresh = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    (autoRefresh ? '<meta http-equiv="refresh" content="30">' : '') +
    `<title>${esc(title)}</title><style>` +
    `:root{--bg:#f4f5fb;--card:#fff;--border:#e7e9f2;--text:#0f172a;--muted:#64748b;--brand:#8C1C3F}` +
    `*{box-sizing:border-box}html,body{margin:0}` +
    `body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text)}` +
    `.room{max-width:680px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;background:var(--bg)}` +
    `.head{background:linear-gradient(135deg,#8C1C3F,#A63255);color:#fff;padding:18px 20px}` +
    `.brand{font-weight:800;font-size:18px;letter-spacing:.2px}` +
    `.members{opacity:.9;font-size:13px;margin-top:3px}` +
    `.banner{padding:10px 20px;font-size:13px;font-weight:600}` +
    `.banner.live{background:#ecfdf5;color:#047857;border-bottom:1px solid var(--border)}` +
    `.banner.locked{background:#fef2f2;color:#b91c1c;border-bottom:1px solid var(--border)}` +
    `.chat{flex:1;padding:16px 14px;display:flex;flex-direction:column;gap:8px}` +
    `.msg{display:flex}.msg.right{justify-content:flex-end}` +
    `.bubble{max-width:80%;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:8px 12px;box-shadow:0 1px 2px rgba(0,0,0,.04)}` +
    `.msg.right .bubble{background:#fbe8ec;border-color:#f3c9d4}` +
    `.who{font-size:11px;font-weight:700;color:var(--brand);margin-bottom:2px}` +
    `.txt{font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}` +
    `.time{font-size:10px;color:var(--muted);margin-top:3px;text-align:right}` +
    `.foot{padding:14px 20px;font-size:12px;color:var(--muted);text-align:center;border-top:1px solid var(--border);background:var(--card)}` +
    `.empty{padding:56px 20px;text-align:center;color:var(--muted)}` +
    `.empty h2{color:var(--text);margin:0 0 6px}` +
    `</style></head><body>${body}</body></html>`;
}

export async function renderParentRoom(req: Request, res: Response): Promise<void> {
  const roomId = String(req.params.roomId || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
  );

  const notFound = () =>
    res.status(404).send(
      page('Room not found', `<div class="room"><div class="head"><div class="brand">Wud · Family Room</div></div>` +
        `<div class="empty"><h2>Room not found</h2><p>This Family Room link is invalid or has been removed.</p></div></div>`),
    );

  // Firestore auto-ids are 20 chars of [A-Za-z0-9]; reject anything else early.
  if (!/^[A-Za-z0-9]{15,40}$/.test(roomId)) {
    notFound();
    return;
  }

  try {
    const roomDoc = await db.collection('family_chat_rooms').doc(roomId).get();
    if (!roomDoc.exists) {
      notFound();
      return;
    }
    const room: any = roomDoc.data();
    const expiresAt: Date | null = room.expiresAt?.toDate?.() || null;
    const live = room.active === true && !!expiresAt && Date.now() < expiresAt.getTime();

    const participants: string[] = Array.isArray(room.participants) ? room.participants : [];
    const nameMap: Record<string, string> = {};
    await Promise.all(
      participants.map(async (uid) => {
        const u = (await db.collection('users').doc(uid).get()).data() || {};
        nameMap[uid] = u.displayName || 'Member';
      }),
    );
    const partNames = participants.map((p) => esc(nameMap[p] || 'Member')).join('  ·  ') || 'Family';
    const fmt = (d: Date) => d.toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

    if (!live) {
      res.status(200).send(
        page('Family Room', `<div class="room">` +
          `<div class="head"><div class="brand">Wud · Family Room</div><div class="members">${partNames}</div></div>` +
          `<div class="banner locked">🔒 This Family Room is locked${expiresAt ? ' · ended ' + esc(fmt(expiresAt)) : ''}.</div>` +
          `<div class="empty"><h2>Room locked</h2><p>The 24 hours are over or the room was closed, so the conversation is no longer shown. ` +
          `Ask your family member to renew the room if you need to follow it again.</p></div></div>`),
      );
      return;
    }

    let msgs: any[] = [];
    if (room.chatId) {
      const ms = await db.collection('chats').doc(String(room.chatId)).collection('messages')
        .orderBy('timestamp', 'desc').limit(300).get();
      msgs = ms.docs.map((d) => d.data()).reverse();
    }
    const firstParticipant = participants[0];
    const bubbles = msgs.map((m) => {
      const who = m.senderRole === 'chaperone' ? `${m.senderName || 'Wali'} (Wali)` : (nameMap[m.senderId] || 'Member');
      const side = m.senderId === firstParticipant ? 'left' : 'right';
      const t = m.timestamp?.toDate?.();
      const text = m.isDeletedForEveryone === true
        ? '<i>This message was deleted</i>'
        : (m.type === 'text' || !m.type ? esc(m.text) : `<i>[${esc(m.type)} message]</i>`);
      return `<div class="msg ${side}"><div class="bubble"><div class="who">${esc(who)}</div>` +
        `<div class="txt">${text}</div><div class="time">${t ? esc(fmt(t)) : ''}</div></div></div>`;
    }).join('');

    res.status(200).send(
      page('Family Room', `<div class="room">` +
        `<div class="head"><div class="brand">Wud · Family Room</div><div class="members">${partNames}</div></div>` +
        `<div class="banner live">🟢 Live · locks ${esc(fmt(expiresAt as Date))}</div>` +
        `<div class="chat">${bubbles || '<div class="empty"><p>No messages in this room yet.</p></div>'}</div>` +
        `<div class="foot">Read-only family view. This page refreshes every 30 seconds. Messages can only be sent from the Wud app.</div>` +
        `</div>`, true),
    );
  } catch (error) {
    console.error('[ParentRoom] render error:', error);
    res.status(500).send(
      page('Error', `<div class="empty"><h2>Something went wrong</h2><p>Please try opening this link again in a moment.</p></div>`),
    );
  }
}

// UC-02 family invite LINK ("link and code"). The link a family member shares
// opens this page in any browser: it confirms the invitation is still valid
// and shows the 6-character code plus how to claim the profile in the app.
// It reveals no names or profile details — only the code that is already in
// the link itself.
export async function renderInvite(req: Request, res: Response): Promise<void> {
  const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'");

  const shell = (inner: string) =>
    page('Wud · Family Invite', `<div class="room"><div class="head"><div class="brand">Wud · Family Invite</div></div>${inner}</div>`);

  try {
    let valid = false;
    if (code.length === 6) {
      const snap = await db.collection('invitations')
        .where('inviteCode', '==', code).where('status', '==', 'pending').limit(1).get();
      const inv: any = snap.docs[0]?.data();
      const exp: Date | null = inv?.expiresAt?.toDate?.() || null;
      valid = !!inv && !!exp && exp.getTime() > Date.now();
    }
    if (!valid) {
      res.status(404).send(shell(
        `<div class="empty"><h2>Invite not valid</h2><p>This invite link has expired, was already used, or is incorrect. ` +
        `Ask your family member to create a new one.</p></div>`));
      return;
    }
    res.status(200).send(shell(
      `<div class="empty"><h2>Your family created a profile for you</h2>` +
      `<p>Claim it in the Wud app with this code:</p>` +
      `<p style="font-size:34px;font-weight:800;letter-spacing:8px;color:var(--brand);margin:18px 0">${esc(code)}</p>` +
      `<p style="text-align:left;max-width:420px;margin:0 auto;line-height:1.7">` +
      `1. Install and open the <b>Wud</b> app.<br>` +
      `2. On the login screen tap <b>“Have a family invite code?”</b>.<br>` +
      `3. Enter the code above and claim your profile.</p>` +
      `<p style="margin-top:18px;font-size:12px">The code works for 48 hours from when it was created.</p></div>`));
  } catch (error) {
    console.error('[Invite] render error:', error);
    res.status(500).send(shell(`<div class="empty"><h2>Something went wrong</h2><p>Please try this link again in a moment.</p></div>`));
  }
}
