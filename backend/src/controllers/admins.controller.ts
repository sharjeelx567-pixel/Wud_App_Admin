// @ts-nocheck
import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { admin as firebaseAdmin, db } from '../config/firebase';
import { successResponse, errorResponse, serverTimestamp } from '../utils/helpers';
import { Admin, AdminRole, AdminPermission, ROLE_DEFAULT_PERMISSIONS, ALL_ADMIN_PERMISSIONS } from '../types';
import { logAction } from './audit.controller';

const ALLOWED_ADMIN_ROLES: AdminRole[] = [
  'super_admin',
  'admin',
  'moderator',
  'verification_staff',
  'support_staff',
  'content_moderator',
  'analyst',
];

export async function getRolesAndPermissions(_req: Request, res: Response): Promise<void> {
  res.json(successResponse({
    roles: ALLOWED_ADMIN_ROLES,
    allPermissions: ALL_ADMIN_PERMISSIONS,
    roleDefaultPermissions: ROLE_DEFAULT_PERMISSIONS,
  }));
}

export async function createAdmin(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, displayName, role, permissions } = req.body;
    
    if (!email || !password || !displayName || !role) {
      res.status(400).json(errorResponse('Missing required fields (email, password, displayName, role)'));
      return;
    }

    if (!ALLOWED_ADMIN_ROLES.includes(role)) {
      res.status(400).json(errorResponse('Invalid admin role. Allowed roles: ' + ALLOWED_ADMIN_ROLES.join(', ')));
      return;
    }

    // Only Super Admin can create Super Admins
    if (role === 'super_admin' && req.admin?.role !== 'super_admin') {
      res.status(403).json(errorResponse('Only Super Admins can create another Super Admin'));
      return;
    }

    // Check if admin email already exists in Firestore
    const existingSnap = await db.collection('admins').where('email', '==', email.toLowerCase().trim()).limit(1).get();
    if (!existingSnap.empty) {
      res.status(409).json(errorResponse('An admin with this email already exists'));
      return;
    }

    // Hash password for secure local authentication
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Validate optional custom permissions. '*' is a valid AdminPermission
    // value (grants unrestricted access, same as super_admin's own default)
    // but is deliberately NOT in ALL_ADMIN_PERMISSIONS's catalog of normal
    // assignable permissions — so it needs its own explicit pass-through
    // here, gated to callers who are already super_admin, rather than
    // either (a) being silently dropped for everyone including a
    // legitimate super_admin grant, or (b) slipping through some other
    // check for a non-super_admin holding only admins.create.
    const sanitizedPermissions: AdminPermission[] = (Array.isArray(permissions)
      ? permissions.filter((p: string) => p === '*' || ALL_ADMIN_PERMISSIONS.includes(p as AdminPermission))
      : []
    ).filter((p) => p !== '*' || req.admin?.role === 'super_admin');

    // Create Firebase Auth User or use existing
    let userRecord;
    try {
      userRecord = await firebaseAdmin.auth().getUserByEmail(email.toLowerCase().trim());
      await firebaseAdmin.auth().updateUser(userRecord.uid, { password, displayName });
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') {
        userRecord = await firebaseAdmin.auth().createUser({
          email: email.toLowerCase().trim(),
          password,
          displayName,
          emailVerified: true,
        });
      } else {
        throw e;
      }
    }

    // Set custom user claims in Firebase Auth
    await firebaseAdmin.auth().setCustomUserClaims(userRecord.uid, { admin: true, role });

    // Create Firestore Document
    const newAdmin: Admin = {
      uid: userRecord.uid,
      email: email.toLowerCase().trim(),
      displayName,
      role: role as AdminRole,
      permissions: sanitizedPermissions,
      passwordHash,
      isActive: true,
      createdAt: serverTimestamp() as any,
    };

    await db.collection('admins').doc(userRecord.uid).set(newAdmin);

    // Audit Log
    await logAction(
      req.admin!.uid,
      req.admin!.email,
      'admin_created',
      userRecord.uid,
      'admin',
      { role, email: email.toLowerCase().trim(), permissionsCount: sanitizedPermissions.length },
      req.ip || ''
    );

    // Return created admin without exposing passwordHash
    const { passwordHash: _, ...safeAdmin } = newAdmin;
    res.status(201).json(successResponse(safeAdmin, 'Admin created successfully'));
  } catch (error: any) {
    console.error('[Admins] Create error:', error);
    res.status(500).json(errorResponse('Failed to create admin', error.message || error));
  }
}

export async function listAdmins(_req: Request, res: Response): Promise<void> {
  try {
    const snapshot = await db.collection('admins').orderBy('createdAt', 'desc').get();
    const admins = snapshot.docs.map(doc => {
      const data = doc.data() as Admin;
      const { passwordHash, ...safeData } = data;
      const role = data.role || 'moderator';
      const customPerms = data.permissions || [];
      const defaultPerms = ROLE_DEFAULT_PERMISSIONS[role] || [];
      const effectivePermissions = Array.from(new Set([...defaultPerms, ...customPerms]));

      return {
        ...safeData,
        uid: doc.id,
        effectivePermissions,
      };
    });
    res.json(successResponse(admins));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to fetch admins', error));
  }
}

export async function updateAdmin(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { displayName, role, permissions, password } = req.body;

    const adminDoc = await db.collection('admins').doc(id).get();
    if (!adminDoc.exists) {
      res.status(404).json(errorResponse('Admin not found'));
      return;
    }

    const currentData = adminDoc.data() as Admin;
    const updateData: Partial<Admin> = {};

    if (displayName) {
      updateData.displayName = displayName;
    }

    if (role) {
      if (!ALLOWED_ADMIN_ROLES.includes(role)) {
        res.status(400).json(errorResponse('Invalid admin role. Allowed roles: ' + ALLOWED_ADMIN_ROLES.join(', ')));
        return;
      }
      // Safeguard: cannot demote self
      if (id === req.admin!.uid && currentData.role === 'super_admin' && role !== 'super_admin') {
        res.status(403).json(errorResponse('You cannot demote yourself from Super Admin'));
        return;
      }
      // Privilege-escalation guard: promoting ANYONE to super_admin (self or
      // another admin) must itself be performed by an existing super_admin —
      // mirrors the identical check already enforced in createAdmin. Without
      // this, an admin holding only the `admins.update` permission could
      // grant themselves (or anyone) super_admin, which bypasses every other
      // permission check in the system.
      if (role === 'super_admin' && req.admin!.role !== 'super_admin') {
        res.status(403).json(errorResponse('Only Super Admins can grant Super Admin privileges'));
        return;
      }
      updateData.role = role;
    }

    if (permissions !== undefined) {
      if (Array.isArray(permissions)) {
        // Same '*' handling as createAdmin — explicit pass-through since
        // it's not in ALL_ADMIN_PERMISSIONS's normal catalog, then
        // restricted to super_admin callers only.
        updateData.permissions = permissions
          .filter((p: string) => p === '*' || ALL_ADMIN_PERMISSIONS.includes(p as AdminPermission))
          .filter((p: string) => p !== '*' || req.admin!.role === 'super_admin');
      }
    }

    if (password) {
      // Resetting ANOTHER admin's password is an account-takeover primitive
      // (set a new password, then log in as them). Restrict it to super_admins.
      // A non-super admin may still change their OWN password here.
      if (id !== req.admin!.uid && req.admin!.role !== 'super_admin') {
        res.status(403).json(errorResponse("Only a Super Admin can reset another admin's password."));
        return;
      }
      if (typeof password !== 'string' || password.length < 8) {
        res.status(400).json(errorResponse('Password must be at least 8 characters.'));
        return;
      }
      const salt = await bcrypt.genSalt(10);
      updateData.passwordHash = await bcrypt.hash(password, salt);
      // Changing the password revokes existing sessions for that admin.
      (updateData as any).tokenVersion = firebaseAdmin.firestore.FieldValue.increment(1);
      try {
        await firebaseAdmin.auth().updateUser(id, { password });
      } catch (e) {
        console.warn('[Admins] Firebase auth password update note:', e);
      }
    }

    await db.collection('admins').doc(id).update(updateData);

    // Sync Firebase custom claims if role changed
    if (role) {
      try {
        await firebaseAdmin.auth().setCustomUserClaims(id, { admin: true, role });
      } catch (authErr) {
        console.warn('[Admins] Failed to update Firebase custom claims:', authErr);
      }
    }

    // Audit Log
    await logAction(
      req.admin!.uid,
      req.admin!.email,
      'admin_updated',
      id,
      'admin',
      { updatedFields: Object.keys(updateData) },
      req.ip || ''
    );

    res.json(successResponse(null, 'Admin updated successfully'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to update admin', error));
  }
}

export async function toggleAdminStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (id === req.admin!.uid) {
      res.status(403).json(errorResponse('You cannot change the status of your own account'));
      return;
    }

    const adminDoc = await db.collection('admins').doc(id).get();
    if (!adminDoc.exists) {
      res.status(404).json(errorResponse('Admin not found'));
      return;
    }

    await db.collection('admins').doc(id).update({ isActive: Boolean(isActive) });

    if (!isActive) {
      // Revoke refresh tokens so they are logged out immediately
      try {
        await firebaseAdmin.auth().revokeRefreshTokens(id);
      } catch (e) {
        console.warn('[Admins] Failed to revoke refresh tokens:', e);
      }
    }
    
    await logAction(
      req.admin!.uid,
      req.admin!.email,
      isActive ? 'admin_activated' : 'admin_disabled',
      id,
      'admin',
      { isActive: Boolean(isActive) },
      req.ip || ''
    );

    res.json(successResponse(null, `Admin ${isActive ? 'activated' : 'disabled'} successfully`));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to toggle admin status', error));
  }
}

export async function deleteAdmin(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (id === req.admin!.uid) {
      res.status(403).json(errorResponse('You cannot delete your own account'));
      return;
    }

    const adminDoc = await db.collection('admins').doc(id).get();
    if (!adminDoc.exists) {
      res.status(404).json(errorResponse('Admin not found'));
      return;
    }

    const data = adminDoc.data() as Admin;
    if (data.role === 'super_admin') {
      // Check count of super admins
      const superAdminsSnap = await db.collection('admins').where('role', '==', 'super_admin').get();
      if (superAdminsSnap.size <= 1) {
        res.status(403).json(errorResponse('Cannot delete the last remaining Super Admin'));
        return;
      }
    }

    // Delete from Firebase Auth
    try {
      await firebaseAdmin.auth().deleteUser(id);
    } catch (e) {
      console.warn('[Admins] User deletion in Firebase Auth note:', e);
    }
    
    // Delete from Firestore
    await db.collection('admins').doc(id).delete();
    
    await logAction(req.admin!.uid, req.admin!.email, 'admin_deleted', id, 'admin', { email: data.email, role: data.role }, req.ip || '');

    res.json(successResponse(null, 'Admin deleted successfully'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to delete admin', error));
  }
}
