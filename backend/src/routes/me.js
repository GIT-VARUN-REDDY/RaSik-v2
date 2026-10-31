import { z } from 'zod';
import crypto from 'node:crypto';
import { config, INTERESTS, STYLES } from '../config.js';
import { HttpError, welcomeBonus } from '../auth.js';
import { User, Listener, Call, Payout, tierFor, now, uid } from '../db.js';
import { selfView, saveUpload, deleteMedia, listenerSelf } from '../util.js';
import { broadcastPresence } from '../realtime.js';

const clean = (s) => String(s).replace(/[<>]/g, '').trim();

export default async function (app) {
  const auth = { preHandler: app.auth };

  app.get('/config', async () => ({
    interests: INTERESTS, styles: STYLES, packs: config.economy.packs,
    minPayoutPaise: config.economy.minPayoutPaise, listenerPaisePerCoin: config.economy.listenerPaisePerCoin,
    tiers: config.economy.tiers,
  }));

  app.get('/me', auth, async (req) => {
    const u = await User.findById(req.user._id || req.user.id).lean();
    return selfView(u);
  });

  // One-time onboarding. Gender can never be changed afterwards (prevents men posing as women).
  app.put('/me/onboarding', auth, async (req) => {
    const userId = req.user._id || req.user.id;
    const u = await User.findById(userId);
    if (u.onboarded) throw new HttpError(409, 'Profile already set up.');
    const b = z.object({
      gender: z.enum(['male', 'female']),
      name: z.string().min(2).max(30),
      age: z.number().int().min(18, 'You must be 18 or older.').max(80),
      interests: z.array(z.enum(INTERESTS)).min(3, 'Pick at least 3 interests.').max(8),
    }).parse(req.body);

    u.gender = b.gender;
    u.name = clean(b.name);
    u.age = b.age;
    u.interests = b.interests;
    u.onboarded = true;
    await u.save();

    if (b.gender === 'female') {
      await Listener.findOneAndUpdate(
        { user_id: userId },
        {
          voice_rate: config.economy.defaultVoiceRate,
          video_rate: config.economy.defaultVideoRate,
          challenge: `${crypto.randomInt(1000, 9999)}`,
        },
        { upsert: true, new: true }
      );
    } else {
      await welcomeBonus(userId);
    }

    const updated = await User.findById(userId).lean();
    return selfView(updated);
  });

  app.put('/me/profile', auth, async (req) => {
    const userId = req.user._id || req.user.id;
    const b = z.object({
      name: z.string().min(2).max(30).optional(), bio: z.string().max(200).optional(),
      interests: z.array(z.enum(INTERESTS)).min(3).max(8).optional(),
      languages: z.array(z.string().max(20)).max(5).optional(),
    }).parse(req.body);

    const update = {};
    if (b.name) update.name = clean(b.name);
    if (b.bio !== undefined) update.bio = clean(b.bio);
    if (b.interests) update.interests = b.interests;
    if (b.languages) update.languages = b.languages;

    const u = await User.findByIdAndUpdate(userId, { $set: update }, { new: true }).lean();
    return selfView(u);
  });

  app.post('/me/avatar', auth, async (req) => {
    const userId = req.user._id || req.user.id;
    const file = await saveUpload(req, { kind: 'image', maxBytes: 15e6, scope: 'public' });
    deleteMedia('public', req.user.avatar);
    await User.updateOne({ _id: userId }, { $set: { avatar: file } });

    // A new photo of an approved listener goes back through review
    if (req.user.gender === 'female') {
      const l = await Listener.findOne({ user_id: userId });
      if (l?.approval === 'approved') {
        l.approval = 'pending';
        l.is_available = false;
        l.submitted_at = now();
        await l.save();
        broadcastPresence(userId);
      }
    }
    const u = await User.findById(userId).lean();
    return selfView(u);
  });

  app.post('/me/push-token', auth, async (req) => {
    const userId = req.user._id || req.user.id;
    const { token } = z.object({ token: z.string().max(200) }).parse(req.body);
    await User.updateOne({ _id: userId }, { $set: { push_token: token } });
    return { ok: true };
  });

  // ------------------------------------------------------------------ listener (women) area
  const female = {
    preHandler: async (req, reply) => {
      await app.auth(req, reply);
      if (req.user.gender !== 'female') throw new HttpError(403, 'Listener accounts only.');
    },
  };

  app.get('/listener/verification', female, async (req) => {
    const userId = req.user._id || req.user.id;
    const l = await Listener.findOne({ user_id: userId }).lean();
    return { ...listenerSelf(l), challenge: l?.challenge, hasAvatar: !!req.user.avatar, name: req.user.name };
  });

  // Live selfie video: reads the random code aloud so we verify face AND voice
  app.post('/listener/verification/video', female, async (req) => {
    const userId = req.user._id || req.user.id;
    const l = await Listener.findOne({ user_id: userId });
    if (l?.approval === 'pending') throw new HttpError(409, 'Your application is under review.');
    const file = await saveUpload(req, { kind: 'video', maxBytes: 40e6, scope: 'private' });
    if (l?.video_file) deleteMedia('private', l.video_file);
    await Listener.updateOne({ user_id: userId }, { $set: { video_file: file } });
    return { ok: true };
  });

  // Public voice intro that men can preview
  app.post('/listener/verification/voice', female, async (req) => {
    const userId = req.user._id || req.user.id;
    const l = await Listener.findOne({ user_id: userId });
    if (l?.approval === 'pending') throw new HttpError(409, 'Your application is under review.');
    const file = await saveUpload(req, { kind: 'audio', maxBytes: 8e6, scope: 'public' });
    if (l?.voice_file) deleteMedia('public', l.voice_file);
    await Listener.updateOne({ user_id: userId }, { $set: { voice_file: file } });
    return { ok: true };
  });

  app.post('/listener/verification/submit', female, async (req) => {
    const userId = req.user._id || req.user.id;
    const l = await Listener.findOne({ user_id: userId });
    if (!l) throw new HttpError(400, 'Listener profile not found.');
    if (l.approval === 'pending' || l.approval === 'approved') return listenerSelf(l);
    if (!req.user.avatar) throw new HttpError(400, 'Add a clear profile photo first.');
    if (!l.video_file) throw new HttpError(400, 'Record your verification video first.');
    if (!l.voice_file) throw new HttpError(400, 'Record your voice intro first.');

    l.approval = 'pending';
    l.reject_reason = null;
    l.submitted_at = now();
    await l.save();
    return listenerSelf(l);
  });

  app.put('/listener/settings', female, async (req) => {
    const userId = req.user._id || req.user.id;
    const b = z.object({
      style: z.enum(STYLES).optional(), voiceRate: z.number().int().min(1).optional(), videoRate: z.number().int().min(1).optional(),
      upiId: z.string().regex(/^[\w.\-]{2,}@[a-zA-Z]{2,}$/, 'Enter a valid UPI ID').optional(),
      isAvailable: z.boolean().optional(),
    }).parse(req.body);

    const l = await Listener.findOne({ user_id: userId });
    if (!l) throw new HttpError(400, 'Listener profile not found.');
    const tier = tierFor(l.total_minutes);
    if (b.voiceRate && b.voiceRate > tier.maxVoice) throw new HttpError(400, `Your ${tier.name} level allows up to ${tier.maxVoice} coins/min for voice.`);
    if (b.videoRate && b.videoRate > tier.maxVideo) throw new HttpError(400, `Your ${tier.name} level allows up to ${tier.maxVideo} coins/min for video.`);
    if (b.isAvailable && l.approval !== 'approved') throw new HttpError(403, 'You can go online once your profile is approved.');

    if (b.style !== undefined) l.style = b.style;
    if (b.voiceRate !== undefined) l.voice_rate = b.voiceRate;
    if (b.videoRate !== undefined) l.video_rate = b.videoRate;
    if (b.upiId !== undefined) l.upi_id = b.upiId;
    if (b.isAvailable !== undefined) l.is_available = b.isAvailable;
    await l.save();

    broadcastPresence(userId);
    return listenerSelf(l);
  });

  app.get('/listener/earnings', female, async (req) => {
    const userId = req.user._id || req.user.id;
    const l = await Listener.findOne({ user_id: userId }).lean();
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    const [todayAgg, weekAgg] = await Promise.all([
      Call.aggregate([
        { $match: { listener_id: userId, created_at: { $gte: startOfDay.getTime() }, connected_at: { $ne: null } } },
        { $group: { _id: null, p: { $sum: '$earned_paise' }, s: { $sum: '$seconds' }, n: { $sum: 1 } } },
      ]),
      Call.aggregate([
        { $match: { listener_id: userId, created_at: { $gte: Date.now() - 7 * 86400e3 }, connected_at: { $ne: null } } },
        { $group: { _id: null, p: { $sum: '$earned_paise' } } },
      ]),
    ]);

    const today = todayAgg[0] || { p: 0, s: 0, n: 0 };
    const week = weekAgg[0] || { p: 0 };

    const payouts = await Payout.find({ listener_id: userId })
      .sort({ created_at: -1 })
      .limit(20)
      .lean();

    return {
      balancePaise: l?.balance_paise || 0,
      lifetimePaise: l?.lifetime_paise || 0,
      todayPaise: today.p,
      todayMinutes: Math.round(today.s / 60),
      todayCalls: today.n,
      weekPaise: week.p,
      minPayoutPaise: config.economy.minPayoutPaise,
      upiId: l?.upi_id || null,
      payouts: payouts.map((p) => ({
        id: p._id,
        amountPaise: p.amount_paise,
        upiId: p.upi_id,
        status: p.status,
        note: p.note,
        createdAt: p.created_at,
      })),
    };
  });

  app.post('/listener/payouts', female, async (req) => {
    const userId = req.user._id || req.user.id;
    const { amountPaise } = z.object({ amountPaise: z.number().int().positive() }).parse(req.body);

    const l = await Listener.findOne({ user_id: userId });
    if (!l?.upi_id) throw new HttpError(400, 'Add your UPI ID in settings first.');
    if (amountPaise < config.economy.minPayoutPaise) throw new HttpError(400, `Minimum withdrawal is ₹${config.economy.minPayoutPaise / 100}.`);
    if (amountPaise > l.balance_paise) throw new HttpError(400, 'Amount exceeds your balance.');

    const pending = await Payout.findOne({ listener_id: userId, status: 'requested' });
    if (pending) throw new HttpError(409, 'You already have a withdrawal in progress.');

    const id = uid('po_');
    await Listener.updateOne({ user_id: userId, balance_paise: { $gte: amountPaise } }, { $inc: { balance_paise: -amountPaise } });
    await Payout.create({
      _id: id,
      listener_id: userId,
      amount_paise: amountPaise,
      upi_id: l.upi_id,
      created_at: now(),
    });
    return { id, amountPaise, status: 'requested' };
  });
}
