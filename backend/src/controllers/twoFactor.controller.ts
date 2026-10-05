import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import { db } from '../config/firebase';
import { successResponse, errorResponse, serverTimestamp } from '../utils/helpers';
import { APP_NAME } from '../config/branding';

const BACKUP_CODE_COUNT = 10;
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ── TOTP-secret encryption at rest (AES-256-GCM) ──────────────────────────
// The secret was stored in plaintext; if Firestore is ever read, every
// authenticator seed would be exposed. When TWO_FACTOR_ENC_KEY is set (a
// 32-byte value, hex/base64/utf8), new secrets are stored encrypted with the
// marker prefix below. Decryption transparently returns a legacy plaintext
// secret unchanged, so already-enrolled admins keep working with no re-enrol.
// If the env key is unset, behaviour is identical to before (plaintext) — set
// the key to activate encryption.
const TWO_FA_ENC_PREFIX = 'enc:v1:';
function twoFactorKey(): Buffer | null {
  const raw = process.env.TWO_FACTOR_ENC_KEY;
  if (!raw) return null;
  let buf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) buf = Buffer.from(raw, 'base64');
  else buf = crypto.createHash('sha256').update(raw).digest(); // derive 32B from any passphrase
  return buf.length === 32 ? buf : crypto.createHash('sha256').update(buf).digest();
}
function encryptSecret(plain: string): string {
  const key = twoFactorKey();
  if (!key) return plain; // encryption not configured — unchanged behaviour
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${TWO_FA_ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}
function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return '';
  if (!stored.startsWith(TWO_FA_ENC_PREFIX)) return stored; // legacy plaintext
  const key = twoFactorKey();
  if (!key) return ''; // encrypted but no key available — cannot verify
  try {
    const [ivHex, tagHex, ctHex] = stored.slice(TWO_FA_ENC_PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function base32Decode(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const val = BASE32_CHARS.indexOf(clean[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function base32Encode(buffer: Buffer): string {
  let bits = '';
  for (let i = 0; i < buffer.length; i++) {
    bits += buffer[i].toString(2).padStart(8, '0');
  }
  let base32 = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.substring(i, i + 5);
    base32 += BASE32_CHARS[parseInt(chunk.padEnd(5, '0'), 2)];
  }
  return base32;
}

export function generateSecret(length = 20): string {
  return base32Encode(crypto.randomBytes(length));
}

export function generateURI({ issuer, label, secret }: { issuer: string; label: string; secret: string }): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function getHotpToken(secretBuffer: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', secretBuffer);
  hmac.update(counterBuffer);
  const digest = hmac.digest();
  const offset = digest[digest.length - 1] & 0xf;
  const code = ((digest[offset] & 0x7f) << 24) |
               ((digest[offset + 1] & 0xff) << 16) |
               ((digest[offset + 2] & 0xff) << 8) |
               (digest[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, '0');
}

/** Google-Authenticator-compatible TOTP check using standard RFC 6238 HMAC-SHA1 */
function checkTotp(token: string, secret: string, window = 1): boolean {
  if (!token || !secret) return false;
  try {
    const key = base32Decode(secret);
    const currentStep = Math.floor(Date.now() / 1000 / 30);
    for (let i = -window; i <= window; i++) {
      const expected = getHotpToken(key, currentStep + i);
      if (expected === token) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-')
  );
}


/**
 * Step 1 of enrolment. Generates a secret and returns it with a QR code for the
 * authenticator app. The secret is stored as `pendingTwoFactorSecret` and is NOT
 * active until `enableTwoFactor` confirms the admin can produce a valid code —
 * so a failed enrolment can never lock anyone out.
 */
export async function setupTwoFactor(req: Request, res: Response): Promise<void> {
  try {
    const uid = req.admin!.uid;
    const adminDoc = await db.collection('admins').doc(uid).get();
    if (!adminDoc.exists) {
      res.status(404).json(errorResponse('Admin not found'));
      return;
    }
    const data = adminDoc.data()!;

    if (data.twoFactorEnabled === true) {
      res.status(400).json(errorResponse('Two-factor authentication is already enabled'));
      return;
    }

    const secret = generateSecret();
    const otpauth = generateURI({ issuer: `${APP_NAME} Admin`, label: data.email || uid, secret });
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    await adminDoc.ref.update({
      pendingTwoFactorSecret: encryptSecret(secret),
      pendingTwoFactorCreatedAt: serverTimestamp(),
    });

    res.json(successResponse({ secret, otpauth, qrDataUrl },
      'Scan the QR code, then confirm with a code to enable two-factor authentication'));
  } catch (error) {
    console.error('[2FA] setup error:', error);
    res.status(500).json(errorResponse('Failed to start two-factor setup', error));
  }
}

/**
 * Step 2 of enrolment. Verifies a live code against the pending secret, then
 * promotes it to active and issues one-time backup codes (returned once, stored
 * only as bcrypt hashes).
 */
export async function enableTwoFactor(req: Request, res: Response): Promise<void> {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      res.status(400).json(errorResponse('Verification code is required'));
      return;
    }

    const uid = req.admin!.uid;
    const adminDoc = await db.collection('admins').doc(uid).get();
    const data = adminDoc.data();
    if (!data?.pendingTwoFactorSecret) {
      res.status(400).json(errorResponse('No pending two-factor setup. Start with /2fa/setup.'));
      return;
    }

    if (!checkTotp(code.replace(/\s/g, ''), decryptSecret(data.pendingTwoFactorSecret))) {
      res.status(401).json(errorResponse('Invalid verification code'));
      return;
    }

    const backupCodes = generateBackupCodes();
    const hashed = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

    await adminDoc.ref.update({
      twoFactorSecret: data.pendingTwoFactorSecret,
      twoFactorEnabled: true,
      twoFactorEnabledAt: serverTimestamp(),
      twoFactorBackupCodes: hashed,
      pendingTwoFactorSecret: null,
      pendingTwoFactorCreatedAt: null,
    });

    console.log(`[2FA] Enabled for admin ${data.email}`);
    res.json(successResponse({ backupCodes },
      'Two-factor authentication enabled. Store these backup codes now — they are shown only once.'));
  } catch (error) {
    console.error('[2FA] enable error:', error);
    res.status(500).json(errorResponse('Failed to enable two-factor authentication', error));
  }
}

/**
 * Disabling requires a current code, so a hijacked session cannot silently
 * strip the second factor.
 */
export async function disableTwoFactor(req: Request, res: Response): Promise<void> {
  try {
    const { code } = req.body;
    const uid = req.admin!.uid;
    const adminDoc = await db.collection('admins').doc(uid).get();
    const data = adminDoc.data();

    if (!data?.twoFactorEnabled) {
      res.status(400).json(errorResponse('Two-factor authentication is not enabled'));
      return;
    }
    if (!code || !checkTotp(String(code).replace(/\s/g, ''), decryptSecret(data.twoFactorSecret))) {
      res.status(401).json(errorResponse('A valid current code is required to disable two-factor authentication'));
      return;
    }

    await adminDoc.ref.update({
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: [],
      twoFactorDisabledAt: serverTimestamp(),
    });

    console.log(`[2FA] Disabled for admin ${data.email}`);
    res.json(successResponse(null, 'Two-factor authentication disabled'));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to disable two-factor authentication', error));
  }
}

export async function getTwoFactorStatus(req: Request, res: Response): Promise<void> {
  try {
    const adminDoc = await db.collection('admins').doc(req.admin!.uid).get();
    const data = adminDoc.data() || {};
    res.json(successResponse({
      enabled: data.twoFactorEnabled === true,
      backupCodesRemaining: Array.isArray(data.twoFactorBackupCodes) ? data.twoFactorBackupCodes.length : 0,
    }));
  } catch (error) {
    res.status(500).json(errorResponse('Failed to read two-factor status', error));
  }
}

/**
 * Verifies a submitted TOTP code, falling back to single-use backup codes.
 * Consumed backup codes are removed. Returns true when the factor is satisfied.
 *
 * Exported for use by the login flow.
 */
export async function verifySecondFactor(
  adminId: string,
  adminData: FirebaseFirestore.DocumentData,
  submitted: string
): Promise<boolean> {
  const cleaned = String(submitted || '').replace(/\s/g, '');
  if (!cleaned) return false;

  if (adminData.twoFactorSecret && checkTotp(cleaned, decryptSecret(adminData.twoFactorSecret))) {
    return true;
  }

  const hashes: string[] = Array.isArray(adminData.twoFactorBackupCodes)
    ? adminData.twoFactorBackupCodes
    : [];
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(cleaned.toUpperCase(), hashes[i])) {
      const remaining = hashes.filter((_, idx) => idx !== i);
      await db.collection('admins').doc(adminId).update({ twoFactorBackupCodes: remaining });
      console.log(`[2FA] Backup code consumed for admin ${adminData.email}; ${remaining.length} left`);
      return true;
    }
  }
  return false;
}
