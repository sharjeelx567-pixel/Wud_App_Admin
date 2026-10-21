import { Router } from 'express';
import {
  getDocumentUrl,
  getVerificationStats,
  getIdentityQueue,
  getFullQueue,
  approveIdentity,
  rejectIdentity,
  confirmFullPayment,
  scheduleMeeting,
  approveFullVerification,
  rejectFullVerification,
  requestNewVerification,
  reviewVerification,
  scheduleHumanVerification,
  approveHumanVerification,
  rejectHumanVerification,
  setHumanMeetingLink,
  getHumanVerificationQueue,
  getEducationQueue,
  approveEducation,
  rejectEducation,
  getSingleQueue,
  approveSingle,
  rejectSingle,
  getIncomeQueue,
  approveIncome,
  rejectIncome,
  getPropertyQueue,
  approveProperty,
  rejectProperty,
  getVoiceVerificationQueue,
  approveVoiceVerification,
  rejectVoiceVerification,
} from '../controllers/verification.controller';
import { authenticate, requirePermission } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// NOTE: paths below must match verification/page.tsx's actual api.get/patch
// calls exactly (identity/full as a literal path segment, not a query param
// or suffix) — a prior mismatch here (e.g. `/identity-queue` vs the
// frontend's `/identity/queue`) silently 404'd and made the entire CNIC
// Identity and Full Video Verification queues permanently empty.
// Route param is named :requestId, not :id — every handler below
// destructures `const { requestId } = req.params`, so a mismatched param
// name here would silently pass `undefined` through to Firestore.
router.get('/document-url', requirePermission('verification.view'), getDocumentUrl);
router.get('/stats', requirePermission('verification.view'), getVerificationStats);
router.get('/identity/queue', requirePermission('verification.view'), getIdentityQueue);
router.get('/full/queue', requirePermission('verification.view'), getFullQueue);
router.patch('/identity/:requestId/approve', requirePermission('verification.approve'), approveIdentity);
router.patch('/identity/:requestId/reject', requirePermission('verification.reject'), rejectIdentity);
router.patch('/full/:requestId/approve', requirePermission('verification.approve'), approveFullVerification);
router.patch('/full/:requestId/reject', requirePermission('verification.reject'), rejectFullVerification);
router.patch('/full/:requestId/schedule', requirePermission('verification.approve'), scheduleMeeting);
router.patch('/full/:requestId/confirm-payment', requirePermission('verification.approve'), confirmFullPayment);

// Legacy/unused-by-frontend endpoints — kept for API compatibility but no
// current UI calls these.
router.patch('/:id/request-new', requirePermission('verification.reject'), requestNewVerification);
router.patch('/:id/review', requirePermission('verification.view'), reviewVerification);
router.post('/:id/schedule-human', requirePermission('verification.approve'), scheduleHumanVerification);
router.patch('/:id/approve-human', requirePermission('verification.approve'), approveHumanVerification);
router.patch('/:id/reject-human', requirePermission('verification.reject'), rejectHumanVerification);

// ── Education (VER-06), Confirmed-Single (VER-07), Human Video (VER-08) queues
router.get('/human/queue', requirePermission('verification.view'), getHumanVerificationQueue);
router.patch('/:id/human-meeting-link', requirePermission('verification.approve'), setHumanMeetingLink);
router.get('/education/queue', requirePermission('verification.view'), getEducationQueue);
router.patch('/:id/approve-education', requirePermission('verification.approve'), approveEducation);
router.patch('/:id/reject-education', requirePermission('verification.reject'), rejectEducation);
router.get('/single/queue', requirePermission('verification.view'), getSingleQueue);
router.patch('/:id/approve-single', requirePermission('verification.approve'), approveSingle);
router.patch('/:id/reject-single', requirePermission('verification.reject'), rejectSingle);

// ── Income + Property document review (Premium badges, scope §3 #2)
router.get('/income/queue', requirePermission('verification.view'), getIncomeQueue);
router.patch('/:id/approve-income', requirePermission('verification.approve'), approveIncome);
router.patch('/:id/reject-income', requirePermission('verification.reject'), rejectIncome);
router.get('/property/queue', requirePermission('verification.view'), getPropertyQueue);
router.patch('/:id/approve-property', requirePermission('verification.approve'), approveProperty);
router.patch('/:id/reject-property', requirePermission('verification.reject'), rejectProperty);

// ── Voice & Gender Verification Routes (Admin-Only) ────────────────────────
router.get('/voice-queue', requirePermission('verification.view'), getVoiceVerificationQueue);
router.patch('/:id/approve-voice', requirePermission('verification.approve'), approveVoiceVerification);
router.patch('/:id/reject-voice', requirePermission('verification.reject'), rejectVoiceVerification);

export default router;
