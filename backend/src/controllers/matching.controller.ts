// @ts-nocheck
import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { successResponse, errorResponse } from '../utils/helpers';

export async function getMatchingStats(req: Request, res: Response): Promise<void> {
  try {
    const [matchesSnap, connectionSnap, interestSnap] = await Promise.all([
      db.collection('matches').count().get(),
      db.collection('connection_requests').count().get(),
      db.collection('user_interests').count().get(),
    ]);

    res.json(successResponse({
      totalMatches: matchesSnap.data().count,
      totalConnectionRequests: connectionSnap.data().count,
      totalAnonymousSignals: interestSnap.data().count,
    }));
  } catch (error) {
    console.error('[Matching Admin] getMatchingStats error:', error);
    res.status(500).json(errorResponse('Failed to fetch matching stats', error));
  }
}

export async function getCompatibilityStats(req: Request, res: Response): Promise<void> {
  try {
    const assessmentsSnap = await db.collection('compatibility_assessments').where('isCompleted', '==', true).count().get();
    
    // For distribution, fetch the latest 500 scores. matching_scores docs
    // (see functions/src/index.ts's scoreData) only ever get `updatedAt`
    // written, never `createdAt` — orderBy('createdAt') silently excludes
    // every document missing that field, which made this query always
    // return zero rows regardless of how much real data existed.
    const scoresSnap = await db.collection('matching_scores').orderBy('updatedAt', 'desc').limit(500).get();
    
    let totalScore = 0;
    let count = 0;
    const distribution = {
      '90-100': 0,
      '80-89': 0,
      '70-79': 0,
      '60-69': 0,
      '50-59': 0,
      'Below 50': 0,
    };

    scoresSnap.forEach(doc => {
      const raw = doc.data().compatibilityScore;
      // A deal-breaker conflict is stored as compatibilityScore: null (see
      // functions/src/index.ts) specifically so it's NOT confused with a
      // genuine 0% match — counting it as 0 here would skew the average and
      // wrongly inflate the "Below 50" bucket with non-matches.
      if (raw === null || raw === undefined) return;
      const score = raw;
      totalScore += score;
      count++;

      if (score >= 90) distribution['90-100']++;
      else if (score >= 80) distribution['80-89']++;
      else if (score >= 70) distribution['70-79']++;
      else if (score >= 60) distribution['60-69']++;
      else if (score >= 50) distribution['50-59']++;
      else distribution['Below 50']++;
    });

    res.json(successResponse({
      completedAssessments: assessmentsSnap.data().count,
      averageScore: count > 0 ? (totalScore / count).toFixed(1) : 0,
      distribution
    }));
  } catch (error) {
    console.error('[Matching Admin] getCompatibilityStats error:', error);
    res.status(500).json(errorResponse('Failed to fetch compatibility stats', error));
  }
}

export async function getConnectionRequests(req: Request, res: Response): Promise<void> {
  try {
    // A "request" in the app is TWO things: an interest/like (user_interests)
    // and a formal connect request (connection_requests). The page used to read
    // only connection_requests — a near-empty collection — so the real interest
    // activity (the bulk of it) was invisible ("not match and not interest").
    // Merge both, tagged by kind, so the admin sees every request. Fetch without
    // orderBy + sort in memory so docs missing createdAt are never dropped.
    const [interestsSnap, connsSnap] = await Promise.all([
      db.collection('user_interests').limit(200).get(),
      db.collection('connection_requests').limit(200).get(),
    ]);

    const rows = [
      ...interestsSnap.docs.map((d) => ({ d, kind: 'Interest' as const })),
      ...connsSnap.docs.map((d) => ({ d, kind: 'Connection' as const })),
    ];

    // Resolve every sender/receiver display name once (dedup by uid).
    const uids = new Set<string>();
    rows.forEach(({ d }) => {
      const x = d.data();
      if (x.senderId) uids.add(x.senderId);
      if (x.receiverId) uids.add(x.receiverId);
    });
    const nameMap: Record<string, string> = {};
    await Promise.all(
      [...uids].map(async (uid) => {
        const u = await db.collection('users').doc(uid).get();
        nameMap[uid] = u.data()?.displayName || '';
      })
    );

    const requests = rows.map(({ d, kind }) => {
      const x = d.data();
      return {
        id: `${kind}:${d.id}`,
        kind,
        senderId: x.senderId || '',
        senderName: nameMap[x.senderId] || '',
        recipientId: x.receiverId || '',
        recipientName: nameMap[x.receiverId] || '',
        status: x.status || 'pending',
        createdAt: x.createdAt || null,
      };
    });
    requests.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    res.json(successResponse(requests));
  } catch (error) {
    console.error('[Matching Admin] getConnectionRequests error:', error);
    res.status(500).json(errorResponse('Failed to fetch connection requests', error));
  }
}

export async function getMatches(req: Request, res: Response): Promise<void> {
  try {
    // Mutual matches (both sides accepted). Stored as userA/userB; enrich with
    // names + photos. No orderBy (some docs may lack createdAt) — sort in memory.
    const snap = await db.collection('matches').limit(200).get();
    const uids = new Set<string>();
    snap.docs.forEach((d) => {
      const x = d.data();
      if (x.userA) uids.add(x.userA);
      if (x.userB) uids.add(x.userB);
    });
    const userMap: Record<string, { name: string; photo: string }> = {};
    await Promise.all(
      [...uids].map(async (uid) => {
        const u = (await db.collection('users').doc(uid).get()).data() || {};
        userMap[uid] = { name: u.displayName || '', photo: u.profileImage || '' };
      })
    );

    const matches = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        userA: x.userA || '',
        userAName: userMap[x.userA]?.name || '',
        userAPhoto: userMap[x.userA]?.photo || '',
        userB: x.userB || '',
        userBName: userMap[x.userB]?.name || '',
        userBPhoto: userMap[x.userB]?.photo || '',
        createdAt: x.createdAt || null,
      };
    });
    matches.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    res.json(successResponse(matches));
  } catch (error) {
    console.error('[Matching Admin] getMatches error:', error);
    res.status(500).json(errorResponse('Failed to fetch matches', error));
  }
}

export async function getAnonymousSignals(req: Request, res: Response): Promise<void> {
  try {
    const snapshot = await db.collection('admin_audit_logs')
      .where('action', 'in', ['anonymous_signal_sent', 'anonymous_signal_match'])
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();

    const signals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(successResponse(signals));
  } catch (error) {
    console.error('[Matching Admin] getAnonymousSignals error:', error);
    res.status(500).json(errorResponse('Failed to fetch anonymous signals', error));
  }
}

export async function getDormantProfiles(req: Request, res: Response): Promise<void> {
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // `adminOverrideHide` is an opt-in flag an admin explicitly sets to keep
    // an otherwise-dormant profile visible — the vast majority of docs never
    // have it set at all. A Firestore `== false` filter does NOT match a
    // missing field, so this previously excluded almost every real dormant
    // user and always returned an empty (or near-empty) list regardless of
    // actual inactivity. Filter it out in code instead, where "missing" and
    // "false" are both treated as "not overridden".
    const snapshot = await db.collection('users')
      .where('lastActiveAt', '<', ninetyDaysAgo)
      .limit(200)
      .get();

    const profiles = snapshot.docs
      .filter(doc => doc.data().adminOverrideHide !== true)
      .slice(0, 50)
      .map(doc => ({
        uid: doc.id,
        displayName: doc.data().displayName,
        email: doc.data().email,
        lastActiveAt: doc.data().lastActiveAt?.toDate(),
        isPremium: doc.data().isPremium,
      }));

    res.json(successResponse(profiles));
  } catch (error) {
    console.error('[Matching Admin] getDormantProfiles error:', error);
    res.status(500).json(errorResponse('Failed to fetch dormant profiles', error));
  }
}

