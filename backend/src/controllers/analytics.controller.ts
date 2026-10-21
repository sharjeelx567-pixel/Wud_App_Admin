// @ts-nocheck
import { Request, Response } from 'express';
import { db, admin } from '../config/firebase';
import { successResponse, errorResponse, serverTimestamp } from '../utils/helpers';
import { DashboardStats } from '../types';

export async function getDashboardStats(req: Request, res: Response): Promise<void> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today;

    // Run all count queries in parallel for performance
    const REPORT_OPEN = ['open', 'Open', 'pending', 'Pending'];
    const [
      totalSnap, premiumSnap, pendingPhotosSnap,
      vrPendingSnap, pendingReportsSnap, bannedSnap, todaySnap,
      completedTxSnap, pendingRishtaSnap, pendingCommunitySnap,
      pendingPostReportsSnap, pendingSupportReportsSnap,
      vcEduSnap, vcSingleSnap, vcIncomeSnap, vcPropSnap, voicePendingSnap,
    ] = await Promise.all([
      db.collection('users').count().get(),
      db.collection('users').where('isPremium', '==', true).count().get(),
      db.collection('users').where('photoStatus', '==', 'pending').count().get(),
      // Verification queue awaiting review. The badge used
      // users.verificationStatus, which goes STALE (stays 'pending' even after
      // the request is approved) — so it showed a count with an empty queue.
      // Count the actual submission queue instead (identity/full requests).
      db.collection('verification_requests').where('status', '==', 'pending').count().get(),
      // Reports Center queue = the `reports` collection (user reports). It
      // previously (incorrectly) counted open support_tickets, which is what
      // the separate Support badge is for.
      db.collection('reports').where('status', 'in', REPORT_OPEN).count().get(),
      db.collection('users').where('isBanned', '==', true).count().get(),
      db.collection('users').where('createdAt', '>=', todayTimestamp).count().get(),
      // Same "sum" approach as payments.controller.ts's getSubscriptionMetrics
      // (30-day revenue) — this one is all-time, matching the dashboard's
      // "Revenue Generated" card, which previously always showed PKR 0
      // because DashboardStats never included a totalRevenue field at all.
      db.collection('transactions').where('status', '==', 'completed').get(),
      // Rishta + Community posts awaiting admin approval (their sidebar badges).
      db.collection('rishta_posts').where('status', '==', 'pending').count().get(),
      db.collection('community_posts').where('status', '==', 'pending').count().get(),
      // Post/comment content reports (reportCommunityPost → post_reports). The
      // Reports Center merges this collection with `reports`, so the badge must
      // sum BOTH — otherwise content reports (the common case) show no count.
      db.collection('post_reports').where('status', 'in', REPORT_OPEN).count().get(),
      // The Reports Center page ALSO merges open support tickets into its list,
      // so the badge counts them too (the "Support" badge separately tracks
      // UNREAD tickets — a different metric). Open/pending only; "Waiting for
      // User" and resolved are not admin-actionable here.
      db.collection('support_tickets').where('status', 'in', REPORT_OPEN).count().get(),
      // Document-review verification queues (same ones the Verification page
      // shows): education / confirmed-single / income / property + voice.
      db.collection('verification_center').where('educationStatus', '==', 'pending').count().get(),
      db.collection('verification_center').where('singleStatus', '==', 'pending').count().get(),
      db.collection('verification_center').where('incomeStatus', '==', 'pending').count().get(),
      db.collection('verification_center').where('propertyStatus', '==', 'pending').count().get(),
      db.collection('users').where('voiceVerificationStatus', '==', 'pending').count().get(),
    ]);

    // Development/test payments (isTestPayment:true) are excluded from REAL
    // revenue — they still appear individually in the transactions ledger.
    const totalRevenue = completedTxSnap.docs.reduce(
      (sum, doc) => sum + (doc.data().isTestPayment === true ? 0 : (doc.data().amount || 0)),
      0,
    );

    const stats: DashboardStats = {
      totalUsers: totalSnap.data().count,
      activeUsers: totalSnap.data().count - bannedSnap.data().count,
      todaySignups: todaySnap.data().count,
      premiumUsers: premiumSnap.data().count,
      pendingPhotos: pendingPhotosSnap.data().count,
      // Real pending verification review items across every queue the
      // Verification page shows (NOT the stale users.verificationStatus flag).
      pendingVerifications:
        vrPendingSnap.data().count +
        vcEduSnap.data().count +
        vcSingleSnap.data().count +
        vcIncomeSnap.data().count +
        vcPropSnap.data().count +
        voicePendingSnap.data().count,
      // All three Reports Center sources combined (user reports + post/comment
      // reports + open support tickets) so the badge matches the page.
      pendingReports:
        pendingReportsSnap.data().count +
        pendingPostReportsSnap.data().count +
        pendingSupportReportsSnap.data().count,
      pendingRishtaPosts: pendingRishtaSnap.data().count,
      pendingCommunityPosts: pendingCommunitySnap.data().count,
      bannedUsers: bannedSnap.data().count,
      totalRevenue,
    };

    res.json(successResponse(stats));
  } catch (error) {
    console.error('[Analytics] getDashboardStats error:', error);
    res.status(500).json(errorResponse('Failed to fetch dashboard stats', error));
  }
}

export async function getUserGrowth(req: Request, res: Response): Promise<void> {
  try {
    // Get last 30 days of signups grouped by day
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const snapshot = await db.collection('users')
      .where('createdAt', '>=', thirtyDaysAgo)
      .orderBy('createdAt', 'asc')
      .get();

    // Group by day
    const growthMap: Record<string, number> = {};
    snapshot.docs.forEach(doc => {
      const date = (doc.data().createdAt as any)?.toDate();
      if (date) {
        const key = date.toISOString().split('T')[0];
        growthMap[key] = (growthMap[key] || 0) + 1;
      }
    });

    // Fill missing days with 0
    const result = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      result.push({ date: key, signups: growthMap[key] || 0 });
    }

    res.json(successResponse(result));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch growth data', error));
  }
}

export async function getRecentActivity(req: Request, res: Response): Promise<void> {
  try {
    const snapshot = await db.collection('admin_audit_logs')
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();

    const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(successResponse(logs));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch recent activity', error));
  }
}

