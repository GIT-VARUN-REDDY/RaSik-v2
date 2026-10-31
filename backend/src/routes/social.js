import { z } from 'zod';
import { HttpError } from '../auth.js';
import { Call, User, Listener, Report, Block, uid, now } from '../db.js';
import { mediaUrl } from '../util.js';
import { getIncomingCallForUser } from '../realtime.js';

export default async function (app) {
  const auth = { preHandler: app.auth };

  app.get('/calls/active', auth, async (req) => {
    const me = String(req.user._id || req.user.id);
    const incoming = await getIncomingCallForUser(me);
    return { incoming };
  });

  app.get('/calls', auth, async (req) => {
    const me = req.user.id;
    const calls = await Call.find({
      $or: [{ caller_id: me }, { listener_id: me }],
      status: { $in: ['completed', 'missed', 'rejected', 'cancelled'] },
    }).sort({ created_at: -1 }).limit(60).lean();

    const peerIds = [...new Set(calls.map((c) => (c.caller_id === me ? c.listener_id : c.caller_id)))];
    const peers = await User.find({ _id: { $in: peerIds } }, { name: 1, avatar: 1 }).lean();
    const peerMap = new Map(peers.map((p) => [p._id, p]));

    const result = calls.map((c) => {
      const peerId = c.caller_id === me ? c.listener_id : c.caller_id;
      const peer = peerMap.get(peerId);
      return {
        id: c._id,
        type: c.type,
        status: c.status,
        seconds: c.seconds,
        coins: c.coins,
        earnedPaise: c.earned_paise,
        rating: c.rating,
        createdAt: c.created_at,
        peerId,
        peerName: peer?.name || 'User',
        peerAvatar: mediaUrl(peer?.avatar),
        outgoing: req.user.gender === 'male',
      };
    });

    return { calls: result };
  });

  app.post('/calls/:id/rate', auth, async (req) => {
    const { rating } = z.object({ rating: z.number().int().min(1).max(5) }).parse(req.body);
    const c = await Call.findOne({ _id: req.params.id, caller_id: req.user.id, status: 'completed' });
    if (!c) throw new HttpError(404, 'Call not found.');
    if (c.rating) throw new HttpError(409, 'Already rated.');
    c.rating = rating;
    await c.save();
    await Listener.updateOne(
      { user_id: c.listener_id },
      { $inc: { rating_sum: rating, rating_count: 1 } }
    );
    return { ok: true };
  });

  app.post('/safety/report', auth, async (req) => {
    const b = z.object({ targetId: z.string(), callId: z.string().optional(), reason: z.string().min(3).max(500) }).parse(req.body);
    await Report.create({
      _id: uid('rp_'),
      reporter_id: req.user.id,
      target_id: b.targetId,
      call_id: b.callId || null,
      reason: b.reason,
      created_at: now(),
    });
    return { ok: true };
  });

  app.post('/safety/block', auth, async (req) => {
    const { userId } = z.object({ userId: z.string() }).parse(req.body);
    if (userId === req.user.id) throw new HttpError(400, 'Invalid user.');
    await Block.updateOne(
      { user_id: req.user.id, blocked_id: userId },
      { $setOnInsert: { user_id: req.user.id, blocked_id: userId } },
      { upsert: true }
    );
    return { ok: true };
  });

  app.delete('/safety/block/:userId', auth, async (req) => {
    await Block.deleteOne({ user_id: req.user.id, blocked_id: req.params.userId });
    return { ok: true };
  });

  app.get('/safety/blocks', auth, async (req) => {
    const blocks = await Block.find({ user_id: req.user.id }).lean();
    const blockedIds = blocks.map((b) => b.blocked_id);
    const users = await User.find({ _id: { $in: blockedIds } }, { name: 1 }).lean();
    return {
      blocked: users.map((u) => ({ id: u._id, name: u.name })),
    };
  });
}
