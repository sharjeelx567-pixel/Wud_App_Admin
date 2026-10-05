// @ts-nocheck
import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { db, admin } from '../config/firebase';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  signChallengeToken,
  verifyChallengeToken,
} from '../utils/jwt';
import { successResponse, errorResponse, serverTimestamp } from '../utils/helpers';
import { Admin, AdminPermission, ROLE_DEFAULT_PERMISSIONS } from '../types';
import { verifySecondFactor } from './twoFactor.controller';

// Mirrors the exact computation auth.middleware.ts's `authenticate` does for
// every subsequent request. Without this, the admin object handed back by
// login/2FA/me only ever carried `role` — the frontend's hasPermission()
// then had nothing to check against and silently denied everything except
// super_admin (which short-circuits on role alone), making every
// permission-gated UI element vanish for every other role right after
// signing in, until something else happened to repopulate it.
function computeEffectivePermissions(adminData: Admin): AdminPermission[] {
  const defaultPermissions = ROLE_DEFAULT_PERMISSIONS[adminData.role] || [];
  const customPermissions = adminData.permissions || [];
  return Array.from(new Set([...defaultPermissions, ...customPermissions]));
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json(errorResponse('Email and password are required'));
      return;
    }

    // Find admin by email
    const snapshot = await db.collection('admins').where('email', '==', email.toLowerCase()).limit(1).get();
    if (snapshot.empty) {
      res.status(401).json(errorResponse('Invalid email or password'));
      return;
    }

    const adminDoc = snapshot.docs[0];
    const adminData = adminDoc.data() as Admin;

    // Was checking isActive BEFORE the password comparison and returning a
    // distinct 403 — that let an unauthenticated caller probe any email
    // with a throwaway password and learn, from the status code alone,
    // whether it belongs to a real (if deactivated) admin account, with no
    // valid credentials at all. Only reveal account-state specifics (like
    // "deactivated") after a correct password has actually been proven —
    // every other failure path (no such email, no passwordHash, wrong
    // password) returns the exact same generic response.
    if (!adminData.passwordHash) {
      res.status(401).json(errorResponse('Invalid email or password'));
      return;
    }
    const passwordMatch = await bcrypt.compare(password, adminData.passwordHash);
    if (!passwordMatch) {
      res.status(401).json(errorResponse('Invalid email or password'));
      return;
    }

    if (!adminData.isActive) {
      res.status(403).json(errorResponse('Your account has been deactivated'));
      return;
    }

    // Password is correct. If this admin has a second factor, stop here and
    // issue a short-lived challenge token that can ONLY complete 2FA — it is
    // not an access token and `authenticate` rejects it (no admin session is
    // established until the code is verified).
    if (adminData.twoFactorEnabled === true) {
      const challengeToken = signChallengeToken(adminDoc.id);
      console.log(`[Auth] Password OK, 2FA challenge issued: ${email}`);
      res.json(successResponse({
        requires2FA: true,
        challengeToken,
      }, 'Enter your authenticator code to finish signing in'));
      return;
    }

    // Update last login
    await adminDoc.ref.update({ lastLoginAt: serverTimestamp() });

    const payload = { uid: adminDoc.id, email: adminData.email, role: adminData.role, tv: adminData.tokenVersion || 0 };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    console.log(`[Auth] Admin login: ${email} (${adminData.role})`);

    res.json(successResponse({
      accessToken,
      refreshToken,
      requires2FA: false,
      admin: {
        uid: adminDoc.id,
        email: adminData.email,
        displayName: adminData.displayName,
        role: adminData.role,
        permissions: adminData.permissions || [],
        effectivePermissions: computeEffectivePermissions(adminData),
        // Set on a freshly-bootstrapped super_admin (see seedDefaultAdmin in
        // index.ts) — the console should force a password change / 2FA
        // setup before letting this session do anything else.
        mustChangePassword: adminData.mustChangePassword === true,
      },
    }, 'Login successful'));
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json(errorResponse('An error occurred during login', error));
  }
}

/**
 * Completes a login that stopped at the two-factor challenge. Requires the
 * short-lived challenge token from `login` plus a current authenticator code
 * (or an unused backup code). Only here are real session tokens issued.
 */
export async function loginVerifyTwoFactor(req: Request, res: Response): Promise<void> {
  try {
    const { challengeToken, code } = req.body;
    if (!challengeToken || !code) {
      res.status(400).json(errorResponse('Challenge token and code are required'));
      return;
    }

    let uid: string;
    try {
      uid = verifyChallengeToken(challengeToken).uid;
    } catch {
      res.status(401).json(errorResponse('Invalid or expired challenge. Please sign in again.'));
      return;
    }

    const adminDoc = await db.collection('admins').doc(uid).get();
    if (!adminDoc.exists) {
      res.status(401).json(errorResponse('Admin account not found'));
      return;
    }
    const adminData = adminDoc.data() as Admin;

    // Re-check activation: an admin deactivated between the two steps must not
    // be able to complete the login.
    if (adminData.isActive === false) {
      res.status(403).json(errorResponse('Your account has been deactivated'));
      return;
    }

    const ok = await verifySecondFactor(uid, adminData as any, code);
    if (!ok) {
      console.warn(`[Auth] Failed 2FA attempt for ${adminData.email}`);
      res.status(401).json(errorResponse('Invalid authentication code'));
      return;
    }

    await adminDoc.ref.update({ lastLoginAt: serverTimestamp() });

    const payload = { uid, email: adminData.email, role: adminData.role, tv: adminData.tokenVersion || 0 };
    console.log(`[Auth] Admin login (2FA verified): ${adminData.email}`);

    res.json(successResponse({
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      admin: {
        uid,
        email: adminData.email,
        displayName: adminData.displayName,
        role: adminData.role,
        permissions: adminData.permissions || [],
        effectivePermissions: computeEffectivePermissions(adminData),
      },
    }, 'Login successful'));
  } catch (error) {
    console.error('[Auth] 2FA verify error:', error);
    res.status(500).json(errorResponse('An error occurred verifying your code', error));
  }
}

export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json(errorResponse('Refresh token required'));
      return;
    }

    const decoded = verifyRefreshToken(refreshToken);

    // Re-validate against Firestore on every refresh. Without this, a
    // deactivated or deleted admin could keep minting access tokens for the
    // lifetime of their refresh token.
    const adminDoc = await db.collection('admins').doc(decoded.uid).get();
    if (!adminDoc.exists) {
      res.status(401).json(errorResponse('Admin account not found'));
      return;
    }
    const adminData = adminDoc.data() as Admin;
    if (adminData.isActive === false) {
      res.status(403).json(errorResponse('Your account has been deactivated'));
      return;
    }
    // Reject a refresh token that predates a logout / forced revocation.
    if (((decoded as any).tv || 0) !== (adminData.tokenVersion || 0)) {
      res.status(401).json(errorResponse('This session has been signed out. Please log in again.'));
      return;
    }

    // Role comes from the live document, never from the presented token.
    const newAccessToken = signAccessToken({
      uid: decoded.uid,
      email: adminData.email,
      role: adminData.role,
      tv: adminData.tokenVersion || 0,
    });

    res.json(successResponse({ accessToken: newAccessToken }, 'Token refreshed'));
  } catch {
    res.status(401).json(errorResponse('Invalid or expired refresh token'));
  }
}

export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    const adminDoc = await db.collection('admins').doc(req.admin!.uid).get();
    if (!adminDoc.exists) {
      res.status(404).json(errorResponse('Admin not found'));
      return;
    }
    const data = adminDoc.data() as Admin;
    res.json(successResponse({
      uid: adminDoc.id,
      email: data.email,
      displayName: data.displayName,
      role: data.role,
      permissions: data.permissions || [],
      // authenticate() already computed this for the current request from
      // the same Firestore data — reuse it rather than recomputing.
      effectivePermissions: req.admin!.effectivePermissions,
    }));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch admin profile', error));
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  // Bump the admin's tokenVersion so every access/refresh token issued before
  // now stops verifying (real revocation, not just a client-side token drop).
  // Identify the admin from whichever token is presented — access token in the
  // Authorization header, or the refresh token in the body.
  try {
    let uid: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try { uid = (verifyAccessToken(authHeader.split(' ')[1]) as any)?.uid || null; } catch {}
    }
    if (!uid && req.body?.refreshToken) {
      try { uid = (verifyRefreshToken(req.body.refreshToken) as any)?.uid || null; } catch {}
    }
    if (uid) {
      await db.collection('admins').doc(uid).update({
        tokenVersion: admin.firestore.FieldValue.increment(1),
      });
    }
  } catch {
    // Never fail logout — worst case the token simply expires on its own.
  }
  res.json(successResponse(null, 'Logged out successfully'));
}
