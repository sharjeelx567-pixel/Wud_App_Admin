// @ts-nocheck
import { Request, Response } from 'express';
import { db, admin } from '../config/firebase';
import { successResponse, errorResponse, createAuditLog, getClientIp, serverTimestamp } from '../utils/helpers';
import { AppSettings } from '../types';

const SETTINGS_DOC_ID = 'config';

export async function getSettings(req: Request, res: Response): Promise<void> {
  try {
    const doc = await db.collection('app_settings').doc(SETTINGS_DOC_ID).get();
    if (!doc.exists) {
      const defaultSettings: AppSettings = {
        maintenanceMode: false,
        premiumMonthlyPrice: 9.99,
        premiumYearlyPrice: 79.99,
        maxPhotosPerUser: 5,
        allowRegistration: true,
        requireEmailVerification: true,
        matchingEnabled: true,
        chatEnabled: true,
        featureFlags: {
          videoVerification: true,
          socialLogin: true,
          dailyMatchesLimit: false,
        },
      };
      
      await db.collection('app_settings').doc(SETTINGS_DOC_ID).set(defaultSettings);
      res.json(successResponse(defaultSettings));
      return;
    }
    
    res.json(successResponse(doc.data()));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch settings', error));
  }
}

// Only these keys may be written, each with an enforced type — raw
// `set(req.body)` previously allowed arbitrary keys/types into app config.
const BOOLEAN_KEYS = [
  'maintenanceMode', 'allowRegistration', 'requireEmailVerification',
  'matchingEnabled', 'chatEnabled',
];
const NUMBER_KEYS = ['premiumMonthlyPrice', 'premiumYearlyPrice', 'maxPhotosPerUser'];
const FEATURE_FLAG_KEYS = ['videoVerification', 'socialLogin', 'dailyMatchesLimit'];

function sanitizeSettings(body: any): { data: Record<string, any>; error?: string } {
  const data: Record<string, any> = {};
  for (const k of BOOLEAN_KEYS) {
    if (k in body) {
      if (typeof body[k] !== 'boolean') return { data, error: `${k} must be a boolean` };
      data[k] = body[k];
    }
  }
  for (const k of NUMBER_KEYS) {
    if (k in body) {
      const n = Number(body[k]);
      if (!Number.isFinite(n) || n < 0) return { data, error: `${k} must be a non-negative number` };
      data[k] = n;
    }
  }
  if ('featureFlags' in body) {
    const ff = body.featureFlags;
    if (typeof ff !== 'object' || ff === null) return { data, error: 'featureFlags must be an object' };
    const flags: Record<string, boolean> = {};
    for (const k of FEATURE_FLAG_KEYS) {
      if (k in ff) {
        if (typeof ff[k] !== 'boolean') return { data, error: `featureFlags.${k} must be a boolean` };
        flags[k] = ff[k];
      }
    }
    data.featureFlags = flags;
  }
  return { data };
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  try {
    const { data: settingsData, error } = sanitizeSettings(req.body || {});
    if (error) {
      res.status(400).json(errorResponse(error));
      return;
    }
    if (Object.keys(settingsData).length === 0) {
      res.status(400).json(errorResponse('No valid settings provided.'));
      return;
    }

    await db.collection('app_settings').doc(SETTINGS_DOC_ID).set(settingsData, { merge: true });

    await createAuditLog({
      adminId: req.admin!.uid,
      adminEmail: req.admin!.email,
      action: 'UPDATE_SETTINGS',
      targetId: SETTINGS_DOC_ID,
      targetType: 'setting',
      details: settingsData,
      timestamp: new Date(),
      ip: getClientIp(req),
    });

    res.json(successResponse(settingsData, 'App configurations updated successfully.'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to update settings', error));
  }
}

