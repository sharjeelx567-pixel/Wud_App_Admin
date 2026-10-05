// @ts-nocheck
import { S3Client } from '@aws-sdk/client-s3';

// R2 credentials come ONLY from the environment (.env locally, Vercel env in
// production). Hardcoded fallback keys used to live here — they were committed
// to source and must be treated as leaked: rotate them in Cloudflare.


// Cloudflare R2 is the storage provider for uploaded files in this backend.
// profile/chat/voice/video mirror the same bucket names the Cloud Functions
// codebase uses (functions/src/index.ts r2Buckets, functions/.env.example) —
// added so admin-initiated account deletion can sweep every category a user
// might have uploaded to, not just the 3 categories this backend previously
// had its own routes for.
export const r2Buckets = {
  support: {
    bucket: process.env.R2_SUPPORT_BUCKET || 'nikkah-support-media',
    domain: process.env.R2_SUPPORT_DOMAIN || 'https://pub-a029a56aa21e415c90dd77feff57ae66.r2.dev',
  },
  admin: {
    bucket: process.env.R2_ADMIN_BUCKET || 'nikkah-admin-media',
    domain: process.env.R2_ADMIN_DOMAIN || 'https://pub-d2bc804549864377ba48d6d120d2ed5f.r2.dev',
  },
  verification: {
    bucket: process.env.R2_VERIFICATION_BUCKET || 'nikkah-verification-media',
    domain: '',
  },
  profile: {
    bucket: process.env.R2_PROFILE_BUCKET || 'nikkah-profile-media',
    domain: process.env.R2_PROFILE_DOMAIN || '',
  },
  chat: {
    bucket: process.env.R2_CHAT_BUCKET || 'nikkah-chat-media',
    domain: process.env.R2_CHAT_DOMAIN || '',
  },
  voice: {
    bucket: process.env.R2_VOICE_BUCKET || 'nikkah-voice-media',
    domain: process.env.R2_VOICE_DOMAIN || '',
  },
  video: {
    bucket: process.env.R2_VIDEO_BUCKET || 'nikkah-video-media',
    domain: process.env.R2_VIDEO_DOMAIN || '',
  },
} as const;

let _r2Client: S3Client | null = null;

export function getR2Client(): S3Client | null {
  if (_r2Client) return _r2Client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.warn('[R2] Missing R2 credentials.');
    return null;
  }

  try {
    _r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId.trim()}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
      },
    });
    return _r2Client;
  } catch (err) {
    console.error('[R2] Failed to initialize S3Client:', err);
    return null;
  }
}

export const r2Client = new Proxy({} as S3Client, {
  get(target, prop) {
    const client = getR2Client();
    if (!client) {
      throw new Error('R2 client not configured. Please set R2 environment variables in Vercel.');
    }
    const val = (client as any)[prop];
    if (typeof val === 'function') {
      return val.bind(client);
    }
    return val;
  }
});


