import { Router } from 'express';
import {
  getMatchingStats,
  getCompatibilityStats,
  getConnectionRequests,
  getMatches,
  getAnonymousSignals,
  getDormantProfiles,
} from '../controllers/matching.controller';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/stats', requirePermission('connections.view', 'analytics.view'), getMatchingStats);
router.get('/compatibility', requirePermission('connections.view', 'analytics.view'), getCompatibilityStats);
router.get('/connections', requirePermission('connections.view'), getConnectionRequests);
router.get('/matches', requirePermission('connections.view'), getMatches);
router.get('/signals', requirePermission('connections.view'), getAnonymousSignals);
// Frontend (connections/page.tsx) calls /matching/dormant-profiles, not /dormant.
router.get('/dormant-profiles', requirePermission('connections.view', 'users.view'), getDormantProfiles);

export default router;
