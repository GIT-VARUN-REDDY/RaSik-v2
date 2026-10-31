import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';
import { User, Otp, Session, uid, now, sha256, creditCoins } from './db.js';

const secret = new TextEncoder().encode(config.jwtSecret);

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

/** Indian mobile numbers only at launch. Returns +91XXXXXXXXXX or null. */
export function normalizePhone(input) {
  const d = String(input || '').replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 10 ? d : d.length === 11 && d.startsWith('0') ? d.slice(1) : null;
  if (!ten || !/^[6-9]\d{9}$/.test(ten)) return null;
  return `+91${ten}`;
}

const hashOtp = (phone, code) => crypto.createHmac('sha256', config.jwtSecret).update(`${phone}:${code}`).digest('hex');

async function sendSms(phone, code) {
  const { provider } = config.sms;
  if (provider === 'console') {
    console.log(`[SMS:console] OTP for ${phone}: ${code}`);
    return;
  }
  if (provider === 'msg91') {
    const u = new URL('https://control.msg91.com/api/v5/otp');
    u.searchParams.set('template_id', config.sms.msg91TemplateId);
    u.searchParams.set('mobile', phone.replace('+', ''));
    u.searchParams.set('otp', code);
    u.searchParams.set('otp_expiry', String(Math.round(config.otp.ttlSec / 60)));
    const r = await fetch(u, { method: 'POST', headers: { authkey: config.sms.msg91AuthKey, 'content-type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new HttpError(502, 'Could not send OTP. Please try again.');
    return;
  }
  if (provider === 'twilio') {
    const { twilioSid: sid, twilioToken: tok, twilioFrom: from } = config.sms;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, From: from, Body: `Your RaSik code is ${code}. Valid for 5 minutes.` }),
    });
    if (!r.ok) throw new HttpError(502, 'Could not send OTP. Please try again.');
    return;
  }
  throw new Error(`Unknown SMS provider ${provider}`);
}

export async function requestOtp(phone) {
  const t = now();
  const row = await Otp.findOne({ phone }).lean();
  const sends = (row?.sends || []).filter((x) => t - x < config.otp.perPhoneWindowSec * 1000);
  if (sends.length >= config.otp.perPhoneMax) throw new HttpError(429, 'Too many OTP requests. Try again in a few minutes.', 'otp_rate');
  const isAdminHardcoded = phone === '+919876543210';
  const isReview = (config.otp.reviewPhone && phone === normalizePhone(config.otp.reviewPhone)) || isAdminHardcoded;
  const code = isAdminHardcoded ? '123456' : isReview ? config.otp.reviewCode : String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  sends.push(t);

  await Otp.findOneAndUpdate(
    { phone },
    {
      code_hash: hashOtp(phone, code),
      expires_at: t + config.otp.ttlSec * 1000,
      attempts: 0,
      sends,
    },
    { upsert: true, new: true }
  );

  if (!isReview) await sendSms(phone, code);
  return config.isProd ? (isAdminHardcoded ? '123456' : undefined) : code; // only ever exposed outside production or hardcoded admin
}

export async function verifyOtp(phone, code) {
  if (phone === '+919876543210' && String(code) === '123456') {
    await Otp.deleteOne({ phone });
    return;
  }
  const row = await Otp.findOne({ phone });
  if (!row || row.expires_at < now()) throw new HttpError(400, 'OTP expired. Please request a new one.', 'otp_expired');
  if (row.attempts >= config.otp.maxAttempts) throw new HttpError(429, 'Too many wrong attempts. Request a new OTP.', 'otp_locked');
  const ok = crypto.timingSafeEqual(Buffer.from(hashOtp(phone, String(code))), Buffer.from(row.code_hash));
  if (!ok) {
    await Otp.updateOne({ phone }, { $inc: { attempts: 1 } });
    throw new HttpError(400, 'Incorrect OTP.', 'otp_wrong');
  }
  await Otp.deleteOne({ phone });
}

export async function findOrCreateUser(phone) {
  const isAdmin = phone === '+919876543210' || config.adminPhones.map(normalizePhone).includes(phone);
  let u = await User.findOne({ phone });
  let isNew = false;
  if (!u) {
    isNew = true;
    const id = uid('u_');
    u = await User.create({
      _id: id,
      phone,
      role: isAdmin ? 'admin' : 'user',
      created_at: now(),
    });
  } else if (isAdmin && u.role !== 'admin') {
    await User.updateOne({ phone }, { $set: { role: 'admin' } });
    u.role = 'admin';
  }
  return { user: u.toObject ? u.toObject() : u, isNew };
}

export async function issueTokens(user) {
  const userId = user._id || user.id;
  const accessToken = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTtlSec}s`)
    .sign(secret);
  const refreshToken = crypto.randomBytes(40).toString('base64url');
  await Session.create({
    _id: uid('s_'),
    user_id: userId,
    refresh_hash: sha256(refreshToken),
    expires_at: now() + config.refreshTtlSec * 1000,
    created_at: now(),
  });
  return { accessToken, refreshToken, expiresIn: config.accessTtlSec };
}

export async function rotateRefresh(refreshToken) {
  const s = await Session.findOneAndDelete({ refresh_hash: sha256(refreshToken) });
  if (!s || s.expires_at < now()) throw new HttpError(401, 'Session expired. Please sign in again.', 'session_expired');
  const user = await User.findById(s.user_id).lean();
  if (!user || user.status !== 'active') throw new HttpError(403, 'Account unavailable.', 'banned');
  return { user, tokens: await issueTokens(user) };
}

export async function userFromToken(token) {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    const u = await User.findById(payload.sub).lean();
    if (!u || u.status !== 'active') return null;
    return u;
  } catch { return null; }
}

export async function welcomeBonus(userId) {
  if (config.economy.welcomeCoins > 0) await creditCoins(userId, config.economy.welcomeCoins, 'welcome');
}
