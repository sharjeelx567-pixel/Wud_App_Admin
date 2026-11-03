// @ts-nocheck
import { Request, Response } from 'express';
import { db } from '../config/firebase';

// Family Rooms are now CODE based: family members join with the 6-digit code
// inside the app (joinFamilyRoomByCode). Old shared links must no longer
// expose any conversation, so this route only explains how to join.

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

export async function renderParentRoom(_req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'",
  );
  res.status(200).send(
    page(
      'Family Room',
      `<div class="room">` +
        `<div class="head"><div class="brand">Wud · Family Room</div></div>` +
        `<div class="empty"><h2>Join with the 6-digit code</h2>` +
        `<p>Family Rooms no longer open from a link. Open the Wud app, go to ` +
        `<b>Settings → Join a Family Room (code)</b> and enter the 6-digit code ` +
        `your family member shared with you.</p></div>` +
        `</div>`,
    ),
  );
}
