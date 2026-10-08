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
    const [
      totalSnap, premiumSnap, pendingPhotosSnap,
      pendingVerifSnap, pendingReportsSnap, bannedSnap, todaySnap,
      completedTxSnap,
    ] = await Promise.all([
      db.collection('users').count().get(),
      db.collection('users').where('isPremium', '==', true).count().get(),
      db.collection('users').where('photoStatus', '==', 'pending').count().get(),
      db.collection('users').where('verificationStatus', '==', 'pending').count().get(),
      db.collection('support_tickets').where('status', 'in', ['open', 'Open']).count().get(),
      db.collection('users').where('isBanned', '==', true).count().get(),
      db.collection('users').where('createdAt', '>=', todayTimestamp).count().get(),
      // Same "sum" approach as payments.controller.ts's getSubscriptionMetrics
      // (30-day revenue) — this one is all-time, matching the dashboard's
      // "Revenue Generated" card, which previously always showed PKR 0
      // because DashboardStats never included a totalRevenue field at all.
      db.collection('transactions').where('status', '==', 'completed').get(),
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
      pendingVerifications: pendingVerifSnap.data().count,
      pendingReports: pendingReportsSnap.data().count,
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

