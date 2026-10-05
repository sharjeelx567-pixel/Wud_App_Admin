import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { db, admin as firebaseAdmin } from '../config/firebase';
import { AdminRole, AdminPermission, AdminJwtPayload, ROLE_DEFAULT_PERMISSIONS } from '../types';

// Extend Express Request to include admin with permissions
declare global {
  namespace Express {
    interface Request {
      admin?: AdminJwtPayload & {
        effectivePermissions: AdminPermission[];
      };
      appUserUid?: string;
    }
  }
}

// For endpoints called by the Flutter app itself (not the admin console) —
// e.g. the "notify admin of a new upload" alert — verifies the caller is a
// genuine signed-in Firebase Auth user via their ID token. This is deliberately
// NOT the same as `authenticate` (which checks admin-console JWTs against the
// `admins` collection): a regular end user has no admin JWT and shouldn't need
// one just to ping the admin panel about their own upload.
export async function verifyFirebaseAppUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Firebase ID token required' });
      return;
    }
    const idToken = authHeader.split(' ')[1];
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    req.appUserUid = decoded.uid;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: 'Invalid or expired Firebase ID token' });
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Authorization token required' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token) as AdminJwtPayload & { typ?: string };

    // A two-factor challenge token is signed with the same secret but is NOT a
    // session: it only authorises completing the 2FA step. Reject it here so a
    // half-authenticated caller can never reach a protected route.
    if (decoded.typ === '2fa_challenge') {
      res.status(401).json({ success: false, error: 'Two-factor authentication not completed' });
      return;
    }

    // Verify admin document in Firestore is still active and get latest role/permissions
    const adminDoc = await db.collection('admins').doc(decoded.uid).get();
    if (!adminDoc.exists) {
      res.status(401).json({ success: false, error: 'Admin account not found' });
      return;
    }

    const adminData = adminDoc.data();
    if (!adminData || adminData.isActive === false) {
      res.status(403).json({ success: false, error: 'Admin account has been deactivated' });
      return;
    }

    // Token revocation: a token whose version stamp predates the admin doc's
    // current tokenVersion was invalidated by a logout or forced revocation.
    if (((decoded as any).tv || 0) !== (adminData.tokenVersion || 0)) {
      res.status(401).json({ success: false, error: 'Session signed out. Please log in again.' });
      return;
    }

    const currentRole: AdminRole = adminData.role || decoded.role;
    const customPermissions: AdminPermission[] = adminData.permissions || [];
    const defaultPermissions = ROLE_DEFAULT_PERMISSIONS[currentRole] || [];

    // Combine custom and default permissions
    const effectivePermissions = Array.from(new Set([...defaultPermissions, ...customPermissions]));

    req.admin = {
      uid: decoded.uid,
      email: adminData.email || decoded.email,
      role: currentRole,
      permissions: customPermissions,
      effectivePermissions,
    };

    next();
  } catch (error) {
    res.status(401).json({ success: false, error: 'Invalid or expired authorization token' });
  }
}

export function requirePermission(...requiredPermissions: AdminPermission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const { role, effectivePermissions } = req.admin;

    // Super Admin has unrestricted access
    if (role === 'super_admin' || effectivePermissions.includes('*')) {
      return next();
    }

    // Check if admin has at least one of the required permissions
    const hasPermission = requiredPermissions.some(perm => effectivePermissions.includes(perm));

    if (!hasPermission) {
      res.status(403).json({
        success: false,
        error: `Forbidden: Missing required permission(s) [${requiredPermissions.join(', ')}]`,
      });
      return;
    }

    next();
  };
}

export function requireRole(...allowedRoles: AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    if (req.admin.role === 'super_admin') {
      return next();
    }

    if (!allowedRoles.includes(req.admin.role)) {
      res.status(403).json({
        success: false,
        error: `Forbidden: Access restricted to roles: ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

// Backward compatibility alias for existing routes
export const authorize = requireRole;
