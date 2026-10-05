import { Router } from 'express';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';
import {
  getUsers,
  getUserById,
  banUser,
  unbanUser,
  suspendUser,
  unsuspendUser,
  deleteUser,
  grantPremium,
  revokePremium,
} from '../controllers/users.controller';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('users.view'), getUsers);
router.get('/:uid', requirePermission('users.view', 'profiles.view'), getUserById);
router.post('/:uid/ban', requirePermission('users.manage'), banUser);
router.post('/:uid/unban', requirePermission('users.manage'), unbanUser);
router.post('/:uid/suspend', requirePermission('users.manage'), suspendUser);
router.post('/:uid/unsuspend', requirePermission('users.manage'), unsuspendUser);
router.delete('/:uid', requirePermission('users.manage'), deleteUser);
router.post('/:uid/premium', requirePermission('subscriptions.manage', 'users.manage'), grantPremium);
router.delete('/:uid/premium', requirePermission('subscriptions.manage', 'users.manage'), revokePremium);

export default router;
