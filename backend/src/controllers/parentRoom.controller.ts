// @ts-nocheck
import { Request, Response } from 'express';
import { db } from '../config/firebase';

// Public, read-only web view of a Family Group Chat Room (COMM-04 "external
// link that works without installing the app"). A parent opens the shareable
// link in a browser and can follow the conversation; they cannot send messages
// (that is only possible from the app, matching the Family Dashboard's
// read-only rule). No auth — the 20-char Firestore room id is the access token.

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
  const { roomId } = req.params;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  // Override helmet's default CSP so the inline stylesheet renders (no scripts).
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'",
  );

  try {
    const roomDoc = await db.collection('family_chat_rooms').doc(roomId).get();
    if (!roomDoc.exists) {
      res.status(404).send(
        page('Room not found', `<div class="empty"><h2>Room not found</h2><p>This family room link is invalid or has been removed.</p></div>`),
      );
      return;
    }

    const room: any = roomDoc.data();
    const chatId: string = room.chatId || '';
    const expiresAt: Date | null = room.expiresAt?.toDate?.() || null;
    const now = new Date();
    const expired = room.active === false || (expiresAt ? now > expiresAt : false);

    const participants: string[] = Array.isArray(room.participants) ? room.participants : [];
    const nameMap: Record<string, string> = {};
    await Promise.all(
      participants.map(async (uid) => {
        const u = (await db.collection('users').doc(uid).get()).data() || {};
        nameMap[uid] = u.displayName || 'Member';
      }),
    );

    let msgs: any[] = [];
    if (chatId) {
      const ms = await db
        .collection('chats').doc(chatId).collection('messages')
        .orderBy('timestamp', 'asc').limit(500).get();
      msgs = ms.docs.map((d) => d.data()).filter((m) => m.isDeletedForEveryone !== true);
    }

    const firstParticipant = participants[0];
    const bubbles = msgs
      .map((m) => {
        const who = nameMap[m.senderId] || 'Member';
        const side = m.senderId === firstParticipant ? 'left' : 'right';
        const t = m.timestamp?.toDate?.();
        const time = t
          ? t.toLocaleString('en-PK', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
          : '';
        const text = m.type === 'text' || !m.type ? esc(m.text) : `<i>[${esc(m.type)} message]</i>`;
        return `<div class="msg ${side}"><div class="bubble"><div class="who">${esc(who)}</div><div class="txt">${text}</div><div class="time">${esc(time)}</div></div></div>`;
      })
      .join('');

    const statusBanner = expired
      ? `<div class="banner locked">🔒 This room has ended${expiresAt ? ' · expired ' + esc(expiresAt.toLocaleString('en-PK')) : ''}. You can still read the conversation below.</div>`
      : `<div class="banner live">🟢 Active${expiresAt ? ' · ends ' + esc(expiresAt.toLocaleString('en-PK')) : ''}</div>`;

    const partNames = participants.map((p) => esc(nameMap[p] || 'Member')).join('  ·  ') || 'Family';

    res.status(200).send(
      page(
        'Family Room',
        `<div class="room">` +
          `<div class="head"><div class="brand">Wud · Family Room</div><div class="members">${partNames}</div></div>` +
          statusBanner +
          `<div class="chat">${bubbles || '<div class="empty"><p>No messages in this room yet.</p></div>'}</div>` +
          `<div class="foot">Read-only family view. You can follow the conversation here — messages can only be sent from the Wud app.</div>` +
          `</div>`,
        !expired,
      ),
    );
  } catch (error) {
    console.error('[ParentRoom] render error:', error);
    res.status(500).send(
      page('Error', `<div class="empty"><h2>Something went wrong</h2><p>Please try opening this link again in a moment.</p></div>`),
    );
  }
}
