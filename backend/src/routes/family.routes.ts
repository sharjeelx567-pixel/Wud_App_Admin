import { Router } from 'express';
import { getChaperoneFlags, resolveChaperoneFlag } from '../controllers/family.controller';
import {
  getFamilyStats,
  listFamilyGroups,
  getFamilyGroupDetail,
  setFamilyGroupSuspended,
  listFamilyLinks,
  revokeFamilyLink,
  listChaperones,
  revokeChaperone,
  listMaritalPreferences,
  resetMaritalFlag,
} from '../controllers/familyManagement.controller';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// Chaperone reports (a chaperone flagged a message) — existing.
router.get('/chaperone-flags', requirePermission('chat_moderation.view'), getChaperoneFlags);
router.patch('/chaperone-flags/:id/resolve', requirePermission('chat_moderation.manage'), resolveChaperoneFlag);

// Family & Wali management. Reads need family.view; every action that changes
// a user's family data needs family.manage and is audited.
router.get('/stats', requirePermission('family.view'), getFamilyStats);
router.get('/groups', requirePermission('family.view'), listFamilyGroups);
router.get('/groups/:id', requirePermission('family.view'), getFamilyGroupDetail);
router.post('/groups/:id/suspend', requirePermission('family.manage'), setFamilyGroupSuspended);
router.post('/groups/:id/unsuspend', requirePermission('family.manage'), setFamilyGroupSuspended);
router.get('/links', requirePermission('family.view'), listFamilyLinks);
router.post('/links/:id/revoke', requirePermission('family.manage'), revokeFamilyLink);
router.get('/chaperones', requirePermission('family.view'), listChaperones);
router.post('/chaperones/:id/revoke', requirePermission('family.manage'), revokeChaperone);
router.get('/marital', requirePermission('family.view'), listMaritalPreferences);
router.post('/marital/:uid/reset', requirePermission('family.manage'), resetMaritalFlag);

export default router;
