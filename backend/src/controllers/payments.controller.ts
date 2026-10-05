// @ts-nocheck
import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { successResponse, errorResponse } from '../utils/helpers';
import { Query, Timestamp, FieldValue } from 'firebase-admin/firestore';

export async function getTransactions(req: Request, res: Response): Promise<void> {
  try {
    const { status, type, limit = 50 } = req.query;
    
    let query: Query = db.collection('transactions').orderBy('timestamp', 'desc');

    if (status) {
      query = query.where('status', '==', status);
    }
    if (type) {
      query = query.where('type', '==', type);
    }

    const snapshot = await query.limit(Number(limit)).get();

    // Transaction docs (see processMockSubscriptionPayment in
    // functions/src/premium/mockPayment.ts, or the future real XPay
    // callback) only store userId — enrich with display name/email for the
    // admin table.
    const transactions = await Promise.all(
      snapshot.docs.map(async (doc: any) => {
        const data = doc.data();
        let userName = '';
        let userEmail = '';
        if (data.userId) {
          const userDoc = await db.collection('users').doc(data.userId).get();
          const user = userDoc.data();
          userName = user?.displayName || '';
          userEmail = user?.email || '';
        }
        return { id: doc.id, ...data, userName, userEmail };
      })
    );

    res.json(successResponse(transactions));
  } catch (error) {
    console.error('[Payments Admin] getTransactions error:', error);
    res.status(500).json(errorResponse('Failed to fetch transactions', error));
  }
}

export async function refundTransaction(req: Request, res: Response): Promise<void> {
  try {
    const txId = req.params.id as string;
    const { reason } = req.body;

    const txRef = db.collection('transactions').doc(txId);
    const txDoc = await txRef.get();

    if (!txDoc.exists) {
      res.status(404).json(errorResponse('Transaction not found'));
      return;
    }

    const txData = txDoc.data()!;
    if (txData.status === 'refunded') {
      res.status(400).json(errorResponse('Already refunded'));
      return;
    }

    const batch = db.batch();
    batch.update(txRef, { 
      status: 'refunded',
      refundReason: reason || 'Admin requested',
      updatedAt: FieldValue.serverTimestamp()
    });

    if (txData.type === 'subscription') {
      batch.update(db.collection('users').doc(txData.userId), {
        isPremium: false,
        premiumPlanId: null,
      });
    }

    batch.set(db.collection('admin_audit_logs').doc(), {
      action: 'transaction_refunded',
      txId,
      userId: txData.userId,
      amount: txData.amount,
      reason,
      adminId: (req as any).admin?.uid || 'system',
      timestamp: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    res.json(successResponse({ success: true, message: 'Refund processed successfully' }));
  } catch (error) {
    console.error('[Payments Admin] refundTransaction error:', error);
    res.status(500).json(errorResponse('Failed to refund transaction', error));
  }
}

export async function getSubscriptionMetrics(req: Request, res: Response): Promise<void> {
  try {
    const snapshot = await db.collection('users').where('isPremium', '==', true).get();
    const activePremiumCount = snapshot.size;

    let monthlyRevenue = 0;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const txSnapshot = await db.collection('transactions')
      .where('status', '==', 'completed')
      .where('timestamp', '>=', Timestamp.fromDate(thirtyDaysAgo))
      .get();

    txSnapshot.docs.forEach(doc => {
      monthlyRevenue += doc.data().amount || 0;
    });

    res.json(successResponse({ activePremiumCount, monthlyRevenue }));
  } catch (error) {
    console.error('[Payments Admin] getSubscriptionMetrics error:', error);
    res.status(500).json(errorResponse('Failed to fetch subscription metrics', error));
  }
}

