import 'dotenv/config';
// @ts-nocheck
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { initializeFirebase, db } from './config/firebase';
import apiRoutes from './routes';
import * as bcrypt from 'bcryptjs';
import { APP_NAME } from './config/branding';

// JWT_SECRET/JWT_REFRESH_SECRET/DEFAULT_ADMIN_EMAIL/DEFAULT_ADMIN_PASSWORD
// used to fall back to hardcoded literal values here whenever the real env
// vars were unset ("so missing env vars on Vercel do not crash cold
// starts") — those literals were committed to source, so anyone reading
// this repo could forge a valid admin JWT for any known admin uid, or log
// in as a real super_admin using the well-known default credentials, on
// any deployment that didn't happen to have every one of these four env
// vars explicitly set. Fail fast instead: a missing secret must stop the
// process, not silently substitute a public, guessable one.
function requireEnv(keys: string[]) {
  const missing = keys.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('[FATAL] Missing required environment variables:', missing.join(', '));
    console.error('[FATAL] Refusing to start with an insecure/undefined JWT or admin-bootstrap secret.');
    process.exit(1);
  }
}

requireEnv(['JWT_SECRET', 'JWT_REFRESH_SECRET']);

try {
  initializeFirebase();
} catch (e) {
  console.error('[Firebase] Uncaught error in init:', e);
}

const app = express();

// Disable x-powered-by header safely
app.disable('x-powered-by');

// REQUIRED for Vercel - trust the proxy so rate-limiter works correctly
app.set('trust proxy', 1);

app.use(helmet({
  hidePoweredBy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Robust CORS handling for localhost, custom domains, and all *.vercel.app preview / prod deployments
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const isAllowed =
      origin.includes('localhost') ||
      origin.endsWith('.vercel.app') ||
      origin.includes('nikkah-connect') ||
      (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL);

    if (isAllowed) {
      return callback(null, true);
    }
    // Not allowlisted: respond WITHOUT CORS headers so the browser blocks the
    // cross-origin request (was previously a permissive `callback(null, true)`
    // that accepted every origin, defeating the allowlist). `false` here is
    // not an error — the request still completes server-side, it just can't be
    // read by a disallowed origin's page.
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
}));

// Pre-flight OPTIONS handler
app.options('*', cors());

// Static files for uploads (fallback for local dev)
try {
  app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));
} catch {}

// Global safety limiter. 5000/15min was effectively no protection; 600/15min
// per IP is generous for a human admin but stops scripted abuse. The tighter
// login/2fa/refresh limiters live on those routes.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});
app.use('/api', limiter);
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

app.use('/api', apiRoutes);

app.get(['/', '/api'], (req, res) => {
  res.json({
    name: `${APP_NAME} Admin API`,
    version: '1.0.0',
    status: 'online',
    firebase: db ? 'connected' : 'uninitialized',
    env: process.env.NODE_ENV || 'production'
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler so Express always responds with valid JSON
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Unhandled Error]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// Previously fell back to the literal 'admin@nikkahconnect.com' /
// 'Admin@123456' whenever DEFAULT_ADMIN_EMAIL/DEFAULT_ADMIN_PASSWORD were
// unset — those exact values are now public (committed to source history),
// so on any deployment that skipped setting them, or on any redeploy after
// the `admins` collection was ever emptied, this would silently recreate a
// real super_admin account with a publicly known password. Only ever seeds
// from EXPLICITLY configured env vars now, and refuses outright if the
// configured password is one of the known-leaked/weak values.
const KNOWN_WEAK_ADMIN_PASSWORDS = new Set(['admin@123456', 'password', 'admin123', 'changeme']);

async function seedDefaultAdmin() {
  try {
    if (!db) {
      console.warn('[Seed] Firestore not initialized yet. Skipping seed.');
      return;
    }
    const snap = await db.collection('admins').limit(1).get();
    if (!snap.empty) return;

    const email = process.env.DEFAULT_ADMIN_EMAIL;
    const password = process.env.DEFAULT_ADMIN_PASSWORD;

    if (!email || !password) {
      console.error(
        '[Seed] No admin accounts exist and DEFAULT_ADMIN_EMAIL/DEFAULT_ADMIN_PASSWORD are not set. ' +
        'Refusing to auto-create an admin account. Set both explicitly to a real email and a strong, ' +
        'unique password (never a shared/well-known value) to bootstrap the first super_admin, then ' +
        'change that password and enable 2FA immediately after first login.'
      );
      return;
    }
    if (KNOWN_WEAK_ADMIN_PASSWORDS.has(password.toLowerCase()) || password.length < 12) {
      console.error(
        '[Seed] DEFAULT_ADMIN_PASSWORD is a known-leaked or too-short value — refusing to seed an admin ' +
        'account with it. Set a strong, unique password (12+ characters, never previously used) and retry.'
      );
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    await db.collection('admins').add({
      email,
      displayName: 'Super Admin',
      role: 'super_admin',
      passwordHash,
      isActive: true,
      // Login response surfaces this so the console can prompt a forced
      // password change / 2FA setup before proceeding.
      mustChangePassword: true,
      createdAt: new Date(),
    });
    console.log('[Seed] Bootstrap super_admin created for', email, '— sign in, change the password, and enable 2FA immediately.');
  } catch (e) {
    console.warn('[Seed] Non-fatal seed error:', e);
  }
}

seedDefaultAdmin();

// Only listen when running standalone directly from CLI (never in serverless)
if (require.main === module && !process.env.VERCEL && !process.env.NOW_REGION && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`[Server] Running on http://0.0.0.0:${PORT}`));
}

if (typeof module !== 'undefined' && module.exports) {
  (app as any).default = app;
  module.exports = app;
  module.exports.default = app;
}

export default app;



