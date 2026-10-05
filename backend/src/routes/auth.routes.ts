
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, refresh, getMe, logout, loginVerifyTwoFactor } from '../controllers/auth.controller';
import {
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  getTwoFactorStatus,
} from '../controllers/twoFactor.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// The global API rate limiter (5000 req/15min) is far too permissive to slow
// a password-guessing attack against a specific admin account. This caps
// login attempts specifically, independent of the global limiter.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Please try again in 15 minutes.' },
});

router.post('/login', loginLimiter, login);
// Same limiter: brute-forcing a 6-digit TOTP is otherwise trivial.
router.post('/login/2fa', loginLimiter, loginVerifyTwoFactor);
// A stolen refresh token could otherwise be hammered to mint access tokens;
// a human only needs to refresh a few times per 15 min.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many refresh attempts. Please sign in again.' },
});
router.post('/refresh', refreshLimiter, refresh);
router.post('/logout', logout);
router.get('/me', authenticate, getMe);

// Two-factor enrolment/management — all require an established admin session.
router.get('/2fa/status', authenticate, getTwoFactorStatus);
router.post('/2fa/setup', authenticate, setupTwoFactor);
router.post('/2fa/enable', authenticate, enableTwoFactor);
router.post('/2fa/disable', authenticate, disableTwoFactor);

export default router;
