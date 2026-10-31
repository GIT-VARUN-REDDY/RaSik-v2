import { z } from 'zod';
import { HttpError, normalizePhone, requestOtp, verifyOtp, findOrCreateUser, issueTokens, rotateRefresh } from '../auth.js';
import { User, Listener, Session, sha256 } from '../db.js';
import { selfView } from '../util.js';
import { config } from '../config.js';

const phoneSchema = z.object({ phone: z.string().min(10).max(16) });

export default async function (app) {
  app.post('/auth/otp/send', { config: { rateLimit: { max: config.limits?.otpSendPerHourPerIp || 15, timeWindow: '1 hour' } } }, async (req) => {
    const { phone: raw } = phoneSchema.parse(req.body);
    const phone = normalizePhone(raw);
    if (!phone) throw new HttpError(400, 'Enter a valid 10-digit Indian mobile number.');
    const devOtp = await requestOtp(phone);
    return { ok: true, phone, ...(devOtp ? { devOtp } : {}) };
  });

  app.post('/auth/otp/verify', { config: { rateLimit: { max: config.limits?.otpVerifyPerHourPerIp || 30, timeWindow: '1 hour' } } }, async (req) => {
    const body = z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) throw new HttpError(400, 'Invalid phone number.');
    await verifyOtp(phone, body.code);
    const { user, isNew } = await findOrCreateUser(phone);
    if (user.status !== 'active') throw new HttpError(403, 'This account has been suspended.', 'banned');
    const tokens = await issueTokens(user);
    const profile = await selfView(user);
    return { ...tokens, isNew, user: profile };
  });

  app.post('/auth/refresh', async (req) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
    const { user, tokens } = await rotateRefresh(refreshToken);
    const profile = await selfView(user);
    return { ...tokens, user: profile };
  });

  app.post('/auth/logout', async (req) => {
    const { refreshToken } = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    if (refreshToken) await Session.deleteOne({ refresh_hash: sha256(refreshToken) });
    return { ok: true };
  });

  // Self-service account deletion (required by Play Store / App Store policies).
  app.delete('/me', { preHandler: app.auth }, async (req) => {
    const id = req.user._id || req.user.id;
    const l = await Listener.findOne({ user_id: id }).lean();
    if (l && l.balance_paise > 0) throw new HttpError(409, 'Withdraw your balance before deleting your account.');
    await User.updateOne(
      { _id: id },
      { $set: { status: 'deleted', name: 'Deleted user', avatar: null, bio: '', push_token: null, phone: `deleted:${id}` } }
    );
    await Session.deleteMany({ user_id: id });
    await Listener.updateOne({ user_id: id }, { $set: { is_available: false } });
    return { ok: true };
  });
}
