import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function must(name, devDefault) {
  if (env[name]) return env[name];
  if (isProd) throw new Error(`Missing required environment variable: ${name}`);
  return devDefault;
}
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(+v) ? +v : d);

export const config = {
  root,
  isProd,
  port: num(env.PORT, 8001),
  host: env.HOST || '0.0.0.0',
  publicUrl: (env.PUBLIC_URL || `http://localhost:${num(env.PORT, 8001)}`).replace(/\/$/, ''),
  corsOrigins: env.CORS_ORIGINS || '*',
  dataDir: env.DATA_DIR || path.join(root, 'data'),
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rasik',
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: env.CLOUDINARY_API_KEY || '',
    apiSecret: env.CLOUDINARY_API_SECRET || '',
  },
  jwtSecret: must('JWT_SECRET', 'dev-only-secret-change-me-dev-only-secret-0123456789'),
  accessTtlSec: 60 * 60,
  refreshTtlSec: 90 * 24 * 60 * 60,
  adminPhones: (env.ADMIN_PHONES || '7207043199,9876543210').split(',').map((s) => s.trim()).filter(Boolean),

  otp: {
    ttlSec: 300,
    maxAttempts: 5,
    perPhoneWindowSec: 600,
    perPhoneMax: 3,
    // For App Store / Play Store reviewers: fixed OTP for one phone. Leave empty in normal use.
    reviewPhone: env.REVIEW_PHONE || '',
    reviewCode: env.REVIEW_OTP || '',
  },
  sms: {
    provider: env.SMS_PROVIDER || (isProd ? 'msg91' : 'console'), // console | msg91 | twilio
    msg91AuthKey: env.MSG91_AUTH_KEY || '',
    msg91TemplateId: env.MSG91_TEMPLATE_ID || '',
    twilioSid: env.TWILIO_ACCOUNT_SID || '',
    twilioToken: env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: env.TWILIO_FROM || '',
  },
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  // Free mock payments are only ever allowed outside production.
  mockPayments: !isProd && !env.RAZORPAY_KEY_ID,

  webrtc: {
    stun: (env.STUN_URLS || 'stun:stun.l.google.com:19302').split(','),
    turnUrls: (env.TURN_URLS || '').split(',').filter(Boolean),
    turnSecret: env.TURN_SECRET || '', // coturn static-auth-secret (time-limited creds)
  },

  economy: {
    minuteMs: num(env.MINUTE_MS, 60_000), // tests shrink this
    welcomeCoins: num(env.WELCOME_COINS, 12),
    // What a listener earns per coin the caller spends (paise). 45p => ~50% of average coin revenue.
    listenerPaisePerCoin: num(env.LISTENER_PAISE_PER_COIN, 45),
    minPayoutPaise: num(env.MIN_PAYOUT_PAISE, 20_000),
    defaultVoiceRate: 5,
    defaultVideoRate: 10,
    // Listener rate caps grow with experience (total talk minutes).
    tiers: [
      { name: 'Starter', minMinutes: 0, maxVoice: 6, maxVideo: 12 },
      { name: 'Rising', minMinutes: 300, maxVoice: 9, maxVideo: 18 },
      { name: 'Star', minMinutes: 1500, maxVoice: 14, maxVideo: 28 },
    ],
    packs: [
      { id: 'p49', priceInr: 49, coins: 50, tag: '' },
      { id: 'p99', priceInr: 99, coins: 110, tag: '' },
      { id: 'p199', priceInr: 199, coins: 240, tag: 'Popular' },
      { id: 'p499', priceInr: 499, coins: 640, tag: 'Best value' },
      { id: 'p999', priceInr: 999, coins: 1350, tag: '' },
      { id: 'p1999', priceInr: 1999, coins: 2800, tag: 'VIP' },
    ],
  },
  limits: { otpSendPerHourPerIp: num(env.OTP_SEND_PER_HOUR_IP, 10), otpVerifyPerHourPerIp: num(env.OTP_VERIFY_PER_HOUR_IP, 20) },
  ringSeconds: num(env.RING_SECONDS, 30),
  connectSeconds: num(env.CONNECT_SECONDS, 30),
  disconnectGraceSeconds: num(env.GRACE_SECONDS, 12),
  expoPush: env.EXPO_PUSH !== 'off',
};

export const INTERESTS = [
  'Music', 'Movies', 'Travel', 'Gaming', 'Fitness', 'Foodie', 'Poetry', 'Fashion',
  'Cricket', 'Tech', 'Art', 'Anime', 'Books', 'Late-night talks', 'Dance', 'Comedy',
];
export const STYLES = ['girlfriend', 'friend', 'listener'];
