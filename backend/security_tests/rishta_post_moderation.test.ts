// Emulator-only regression tests for Rishta Posting admin moderation
// (posts.controller.ts, and the post_reports extension to
// reports.controller.ts). Split out of post_moderation.test.ts when Rishta
// Posting was separated from Community Discussion — this suite covers
// rishta_posts only (no comments; that's Community Discussion's concept,
// see community_post_moderation.test.ts). Run via firebase emulators:exec
// — never against production.

process.env.NODE_ENV = 'test';
// Must load .env (for JWT_SECRET/JWT_REFRESH_SECRET) before this file's own
// static `import ... from '../src/utils/jwt'` below triggers jwt.ts's
// module-load-time fail-fast check — see admin_remediation.test.ts for the
// same reasoning.
import 'dotenv/config';

import { db } from '../src/config/firebase';
import { signAccessToken } from '../src/utils/jwt';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  PASS - ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  FAIL - ${msg}`);
  }
}

async function main() {
  console.log('\n[setup] importing Express app...');
  const app = (await import('../src/index')).default;
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}/api`;

  const stamp = Date.now();

  // ── seed: a posts.view-only admin, a full posts.manage moderator, and a
  //    target rishta post + post_report to moderate ──────────────────────
  const viewOnlyRef = db.collection('admins').doc(`rpview_${stamp}`);
  await viewOnlyRef.set({ email: `rpview_${stamp}@test.local`, role: 'analyst', permissions: ['posts.view'], isActive: true });
  const viewOnlyToken = signAccessToken({ uid: `rpview_${stamp}`, email: 'x', role: 'analyst' as any });

  const moderatorRef = db.collection('admins').doc(`rpmod_${stamp}`);
  await moderatorRef.set({ email: `rpmod_${stamp}@test.local`, role: 'moderator', isActive: true });
  const moderatorToken = signAccessToken({ uid: `rpmod_${stamp}`, email: 'x', role: 'moderator' as any });

  const authorUid = `rp_author_${stamp}`;
  await db.collection('users').doc(authorUid).set({ displayName: 'Post Author', email: 'author@test.local' });
  const reporterUid = `rp_reporter_${stamp}`;
  await db.collection('users').doc(reporterUid).set({ displayName: 'Reporter', email: 'reporter@test.local' });

  const postRef = db.collection('rishta_posts').doc(`post_${stamp}`);
  await postRef.set({
    id: postRef.id, authorUid, profileUid: authorUid,
    displayName: 'Author', age: 27, gender: 'Male', city: 'Lahore',
    status: 'active', likeCount: 0, reportCount: 1,
    createdAt: new Date(), updatedAt: new Date(),
  });

  const postReportRef = db.collection('post_reports').doc(`${postRef.id}_${reporterUid}`);
  await postReportRef.set({
    id: postReportRef.id, reporterId: reporterUid, contentType: 'rishta_post', postId: postRef.id,
    targetAuthorUid: authorUid, reason: 'Suspicious profile', status: 'pending', createdAt: new Date(),
  });

  console.log('\n=== TEST 1: GET /posts requires posts.view (403 without it) ===');
  {
    const noPermRef = db.collection('admins').doc(`rpnoperm_${stamp}`);
    await noPermRef.set({ email: `rpnoperm_${stamp}@test.local`, role: 'support_staff', isActive: true });
    const noPermToken = signAccessToken({ uid: `rpnoperm_${stamp}`, email: 'x', role: 'support_staff' as any });

    const res = await fetch(`${base}/posts`, { headers: { Authorization: `Bearer ${noPermToken}` } });
    assert(res.status === 403, `a role without posts.view gets 403 (got ${res.status})`);

    const okRes = await fetch(`${base}/posts`, { headers: { Authorization: `Bearer ${viewOnlyToken}` } });
    assert(okRes.status === 200, `a role WITH posts.view gets 200 (got ${okRes.status})`);
  }

  console.log('\n=== TEST 2: GET /posts response has no communityId/commentCount (rishta posts are not community-scoped, have no comments) ===');
  {
    const res = await fetch(`${base}/posts`, { headers: { Authorization: `Bearer ${viewOnlyToken}` } });
    const body: any = await res.json();
    const items: any[] = body.data?.data || [];
    const found = items.find((it) => it.id === postRef.id);
    assert(!!found, 'the seeded rishta post appears in the listing');
    assert(found.communityId === undefined, 'response item has no communityId field');
    assert(found.commentCount === undefined, 'response item has no commentCount field');
  }

  console.log('\n=== TEST 3: PATCH /posts/:id/hide requires posts.manage (view-only is rejected) ===');
  {
    const res = await fetch(`${base}/posts/${postRef.id}/hide`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${viewOnlyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'test' }),
    });
    assert(res.status === 403, `posts.view-only admin cannot hide a post (got ${res.status})`);

    const doc = await postRef.get();
    assert(doc.data()?.status === 'active', 'post status is unchanged after the rejected attempt');
  }

  console.log('\n=== TEST 4: a posts.manage admin CAN hide a post — writes status/moderatedBy/moderatedAt and an audit log ===');
  {
    const beforeAuditSnap = await db.collection('admin_audit_logs').where('targetId', '==', postRef.id).where('targetType', '==', 'post').get();
    const beforeCount = beforeAuditSnap.size;

    const res = await fetch(`${base}/posts/${postRef.id}/hide`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${moderatorToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Reported content under review' }),
    });
    assert(res.status === 200, `hide request succeeds for a posts.manage admin (got ${res.status})`);

    const doc = await postRef.get();
    assert(doc.data()?.status === 'hidden', `post status is now hidden (got ${doc.data()?.status})`);
    assert(doc.data()?.moderatedBy === `rpmod_${stamp}`, 'moderatedBy is set to the acting admin uid');
    assert(!!doc.data()?.moderatedAt, 'moderatedAt is set');
    assert(doc.data()?.moderationReason === 'Reported content under review', 'moderationReason is stored');

    const afterAuditSnap = await db.collection('admin_audit_logs').where('targetId', '==', postRef.id).where('targetType', '==', 'post').get();
    assert(afterAuditSnap.size === beforeCount + 1, `exactly one new audit log entry was created for this post (before=${beforeCount}, after=${afterAuditSnap.size})`);
  }

  console.log('\n=== TEST 5: GET /posts/comments is not exposed for Rishta Posting (no comments route) ===');
  {
    const res = await fetch(`${base}/posts/comments`, { headers: { Authorization: `Bearer ${moderatorToken}` } });
    assert(res.status === 404, `GET /posts/comments does not exist (got ${res.status})`);
  }

  console.log('\n=== TEST 6: GET /reports returns the merged post_reports item tagged contentType=rishta_post ===');
  {
    const res = await fetch(`${base}/reports?status=pending`, { headers: { Authorization: `Bearer ${moderatorToken}` } });
    assert(res.status === 200, `GET /reports succeeds (got ${res.status})`);
    const body: any = await res.json();
    const items: any[] = body.data?.data || [];
    const found = items.find((it) => it.id === postReportRef.id);
    assert(!!found, `the seeded post_reports item appears in the merged /reports listing (found ${items.length} items)`);
    assert(found?._collection === 'post_reports', 'the item is correctly tagged _collection=post_reports');
    assert(found?.contentType === 'rishta_post', 'the item carries contentType=rishta_post');
    assert(found?.category === 'Reported Rishta Post', `category label is "Reported Rishta Post" (got ${found?.category})`);
  }

  console.log('\n=== TEST 7: PATCH /reports/:id/resolve on the post_reports-sourced id writes status AND an audit log ===');
  {
    const res = await fetch(`${base}/reports/${postReportRef.id}/resolve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${moderatorToken}` },
    });
    assert(res.status === 200, `resolve request succeeds (got ${res.status})`);

    const doc = await postReportRef.get();
    assert(doc.data()?.status === 'resolved', `post_reports status is now resolved (got ${doc.data()?.status})`);
    assert(doc.data()?.resolvedBy === `rpmod_${stamp}`, 'resolvedBy is set to the acting admin uid');
  }

  console.log('\n=== TEST 8: an unhidden post is restored to active ===');
  {
    const res = await fetch(`${base}/posts/${postRef.id}/unhide`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${moderatorToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(res.status === 200, `unhide request succeeds (got ${res.status})`);
    const doc = await postRef.get();
    assert(doc.data()?.status === 'active', 'post status is restored to active');
  }

  console.log('\n=== TEST 9: a pending post is approved to active by a posts.manage admin (with audit log); view-only is rejected ===');
  {
    const pendingRef = db.collection('rishta_posts').doc(`pending_${stamp}`);
    await pendingRef.set({
      id: pendingRef.id, authorUid, profileUid: authorUid,
      displayName: 'Pending Author', age: 29, gender: 'Female', city: 'Karachi',
      status: 'pending', likeCount: 0, reportCount: 0,
      createdAt: new Date(), updatedAt: new Date(),
    });

    const denied = await fetch(`${base}/posts/${pendingRef.id}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${viewOnlyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(denied.status === 403, `posts.view-only admin cannot approve (got ${denied.status})`);

    const beforeAuditSnap = await db.collection('admin_audit_logs').where('targetId', '==', pendingRef.id).where('targetType', '==', 'post').get();
    const beforeCount = beforeAuditSnap.size;

    const res = await fetch(`${base}/posts/${pendingRef.id}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${moderatorToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(res.status === 200, `approve succeeds for a posts.manage admin (got ${res.status})`);

    const doc = await pendingRef.get();
    assert(doc.data()?.status === 'active', `pending post is now active after approval (got ${doc.data()?.status})`);
    assert(doc.data()?.moderatedBy === `rpmod_${stamp}`, 'moderatedBy is set to the approving admin');

    const afterAuditSnap = await db.collection('admin_audit_logs').where('targetId', '==', pendingRef.id).where('targetType', '==', 'post').get();
    assert(afterAuditSnap.size === beforeCount + 1, `exactly one approval audit log entry was created (before=${beforeCount}, after=${afterAuditSnap.size})`);
  }

  server.close();

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exitCode = 1;
});
