import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { HttpError } from '../auth.js';
import { User, Listener, CallMessage, WalletTx, Payout, Report, Session, now, creditCoins } from '../db.js';
import { mediaUrl } from '../util.js';
import { broadcastPresence, onlineCount } from '../realtime.js';

export default async function (app) {
  const admin = {
    preHandler: async (req, reply) => {
      await app.auth(req, reply);
      if (req.user.role !== 'admin') throw new HttpError(403, 'Admins only.');
    },
  };

  app.get('/admin/stats', admin, async () => {
    const [users, men, listeners, pending, pendingPayouts, openReports] = await Promise.all([
      User.countDocuments({ onboarded: true }),
      User.countDocuments({ gender: 'male' }),
      Listener.countDocuments({ approval: 'approved' }),
      Listener.countDocuments({ approval: 'pending' }),
      Payout.countDocuments({ status: 'requested' }),
      Report.countDocuments({ status: 'open' }),
    ]);

    const revenueAgg = await WalletTx.aggregate([
      { $match: { kind: 'recharge' } },
      { $group: { _id: null, total: { $sum: '$amount_paise' } } },
    ]);
    const revenuePaise = revenueAgg[0]?.total || 0;

    const listenerEarnedAgg = await Listener.aggregate([
      { $group: { _id: null, total: { $sum: '$lifetime_paise' } } },
    ]);
    const listenerEarnedPaise = listenerEarnedAgg[0]?.total || 0;

    return {
      users,
      men,
      listeners,
      pending,
      connectedNow: onlineCount(),
      revenuePaise,
      listenerEarnedPaise,
      pendingPayouts,
      openReports,
    };
  });

  app.get('/admin/verifications', admin, async (req) => {
    const status = z.enum(['pending', 'approved', 'rejected']).default('pending').parse(req.query.status);
    const listeners = await Listener.find({ approval: status }).sort({ submitted_at: 1 }).limit(50).lean();
    const userIds = listeners.map((l) => l.user_id);
    const users = await User.find({ _id: { $in: userIds } }).lean();
    const userMap = new Map(users.map((u) => [u._id, u]));

    const items = listeners.map((l) => {
      const u = userMap.get(l.user_id) || {};
      return {
        id: u._id,
        name: u.name,
        age: u.age,
        phone: u.phone,
        avatar: mediaUrl(u.avatar),
        interests: u.interests || [],
        challenge: l.challenge,
        video_file: l.video_file,
        voice_file: l.voice_file,
        voice: mediaUrl(l.voice_file),
        submitted_at: l.submitted_at,
        reject_reason: l.reject_reason,
      };
    });

    return { items };
  });

  // Private verification video: admins only
  app.get('/admin/media/:file', admin, async (req, reply) => {
    // If it's a full Cloudinary URL, redirect
    if (req.params.file.startsWith('http://') || req.params.file.startsWith('https://')) {
      return reply.redirect(req.params.file);
    }
    if (!/^[a-f0-9]{32}\.(mp4|m4a|jpg|png|webp)$/.test(req.params.file)) throw new HttpError(400, 'Bad file');
    const p = path.join(config.dataDir, 'media', 'private', req.params.file);
    if (!fs.existsSync(p)) throw new HttpError(404, 'Not found');
    return reply.type('video/mp4').header('cache-control', 'private, no-store').send(fs.createReadStream(p));
  });

  app.post('/admin/verifications/:id/approve', admin, async (req) => {
    const l = await Listener.findOneAndUpdate(
      { user_id: req.params.id },
      { $set: { approval: 'approved', reject_reason: null, reviewed_at: now() } }
    );
    if (!l) throw new HttpError(404, 'Not found');
    return { ok: true };
  });

  app.post('/admin/verifications/:id/reject', admin, async (req) => {
    const { reason } = z.object({ reason: z.string().min(3).max(200) }).parse(req.body);
    const l = await Listener.findOneAndUpdate(
      { user_id: req.params.id },
      { $set: { approval: 'rejected', reject_reason: reason, is_available: false, reviewed_at: now() } }
    );
    if (!l) throw new HttpError(404, 'Not found');
    broadcastPresence(req.params.id);
    return { ok: true };
  });

  app.get('/admin/payouts', admin, async (req) => {
    const status = z.enum(['requested', 'paid', 'rejected']).default('requested').parse(req.query.status);
    const payouts = await Payout.find({ status }).sort({ created_at: 1 }).limit(100).lean();
    const userIds = payouts.map((p) => p.listener_id);
    const users = await User.find({ _id: { $in: userIds } }, { name: 1, phone: 1 }).lean();
    const userMap = new Map(users.map((u) => [u._id, u]));

    const items = payouts.map((p) => {
      const u = userMap.get(p.listener_id) || {};
      return {
        id: p._id,
        amountPaise: p.amount_paise,
        upiId: p.upi_id,
        status: p.status,
        createdAt: p.created_at,
        name: u.name,
        phone: u.phone,
      };
    });

    return { items };
  });

  app.post('/admin/payouts/:id/paid', admin, async (req) => {
    const { ref } = z.object({ ref: z.string().min(3).max(60) }).parse(req.body);
    const updated = await Payout.findOneAndUpdate(
      { _id: req.params.id, status: 'requested' },
      { $set: { status: 'paid', note: ref, processed_at: now() } }
    );
    if (!updated) throw new HttpError(404, 'Payout not found or not in requested state.');
    return { ok: true };
  });

  app.post('/admin/payouts/:id/reject', admin, async (req) => {
    const { note } = z.object({ note: z.string().min(3).max(200) }).parse(req.body);
    const p = await Payout.findOneAndUpdate(
      { _id: req.params.id, status: 'requested' },
      { $set: { status: 'rejected', note, processed_at: now() } },
      { new: true }
    );
    if (!p) throw new HttpError(404, 'Payout not found or not in requested state.');
    // refund to balance
    await Listener.updateOne({ user_id: p.listener_id }, { $inc: { balance_paise: p.amount_paise } });
    return { ok: true };
  });

  app.get('/admin/reports', admin, async () => {
    const reports = await Report.find({ status: 'open' }).sort({ created_at: -1 }).limit(100).lean();
    const uids = [...new Set([...reports.map((r) => r.reporter_id), ...reports.map((r) => r.target_id)])];
    const users = await User.find({ _id: { $in: uids } }, { name: 1, status: 1 }).lean();
    const userMap = new Map(users.map((u) => [u._id, u]));

    const items = reports.map((r) => {
      const reporter = userMap.get(r.reporter_id);
      const target = userMap.get(r.target_id);
      return {
        id: r._id,
        reason: r.reason,
        callId: r.call_id,
        createdAt: r.created_at,
        reporterName: reporter?.name || 'Unknown',
        targetName: target?.name || 'Unknown',
        targetId: r.target_id,
        targetStatus: target?.status || 'active',
      };
    });

    return { items };
  });

  app.get('/admin/calls/:id/messages', admin, async (req) => {
    const docs = await CallMessage.find({ call_id: req.params.id }).sort({ at: 1 }).lean();
    return {
      items: docs.map((d) => ({
        senderId: d.sender_id,
        text: d.text,
        at: d.at,
      })),
    };
  });

  app.post('/admin/reports/:id/resolve', admin, async (req) => {
    await Report.updateOne({ _id: req.params.id }, { $set: { status: 'resolved' } });
    return { ok: true };
  });

  app.post('/admin/users/:id/ban', admin, async (req) => {
    await User.updateOne({ _id: req.params.id, role: { $ne: 'admin' } }, { $set: { status: 'banned' } });
    await Session.deleteMany({ user_id: req.params.id });
    await Listener.updateOne({ user_id: req.params.id }, { $set: { is_available: false } });
    broadcastPresence(req.params.id);
    return { ok: true };
  });

  app.post('/admin/users/:id/coins', admin, async (req) => {
    const { coins, reason } = z.object({ coins: z.number().int().min(1).max(5000), reason: z.string().min(3) }).parse(req.body);
    await creditCoins(req.params.id, coins, 'admin_credit', reason);
    return { ok: true };
  });
}
