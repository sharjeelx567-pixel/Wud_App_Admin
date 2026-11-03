import { Router } from 'express';
import {
  getCoachSessions,
  updateCoachSession,
  listCoaches,
  registerCoach,
  getMyCoachThreads,
  getCoachMessages,
  sendCoachMessage,
} from '../controllers/coach.controller';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// ── Admin: manage bookings & coaches (subscriptions perms; super_admin bypass)
// Paths must match coach/page.tsx's api calls.
router.get('/sessions', requirePermission('subscriptions.view'), getCoachSessions);
router.patch('/sessions/:id', requirePermission('subscriptions.manage'), updateCoachSession);
router.get('/coaches', requirePermission('subscriptions.view'), listCoaches);
router.post('/coaches', requirePermission('subscriptions.manage'), registerCoach);

// ── Coach's own chats (coach.chat perm; super_admin bypass). Must match
// coach-chats/page.tsx's api calls.
router.get('/my-threads', requirePermission('coach.chat'), getMyCoachThreads);
router.get('/sessions/:id/messages', requirePermission('coach.chat'), getCoachMessages);
router.post('/sessions/:id/messages', requirePermission('coach.chat'), sendCoachMessage);

export default router;
