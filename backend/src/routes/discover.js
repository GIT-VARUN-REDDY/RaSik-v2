import { z } from 'zod';
import { HttpError } from '../auth.js';
import { User, Listener, Block, Favorite } from '../db.js';
import { listenerCard } from '../util.js';
import { listenerState } from '../realtime.js';
import { STYLES } from '../config.js';

export default async function (app) {
  const auth = { preHandler: app.auth };
  const order = { online: 0, busy: 1, offline: 2 };

  // Men browse approved listeners, online first. Offline ones are hidden unless asked for.
  app.get('/listeners', auth, async (req) => {
    const q = z.object({
      style: z.enum(STYLES).optional(), online: z.enum(['0', '1']).default('1'),
      interest: z.string().max(30).optional(), language: z.string().max(20).optional(),
      favorites: z.enum(['0', '1']).default('0'),
    }).parse(req.query);

    const userId = req.user._id || req.user.id;
    if (req.user.gender !== 'male') throw new HttpError(403, 'Members only.');

    // Get blocked user IDs
    const [blocks1, blocks2, userFavs] = await Promise.all([
      Block.find({ user_id: userId }).select('blocked_id').lean(),
      Block.find({ blocked_id: userId }).select('user_id').lean(),
      Favorite.find({ user_id: userId }).select('listener_id').lean(),
    ]);

    const blockedIds = new Set([
      ...blocks1.map((b) => b.blocked_id),
      ...blocks2.map((b) => b.user_id),
    ]);
    const favIds = new Set(userFavs.map((f) => f.listener_id));

    const listenerFilter = { approval: 'approved' };
    if (q.style) listenerFilter.style = q.style;
    if (q.favorites === '1') listenerFilter.user_id = { $in: Array.from(favIds) };

    const approvedListeners = await Listener.find(listenerFilter).lean();
    const candidateUserIds = approvedListeners.map((l) => l.user_id).filter((id) => !blockedIds.has(id));

    const users = await User.find({
      _id: { $in: candidateUserIds },
      status: 'active',
      avatar: { $ne: null },
    }).lean();

    const listenerMap = new Map(approvedListeners.map((l) => [l.user_id, l]));
    const states = await Promise.all(users.map((u) => listenerState(u._id)));

    let list = users.map((u, i) => {
      const l = listenerMap.get(u._id);
      return {
        ...listenerCard(u, l, states[i]),
        isFavorite: favIds.has(u._id),
        _t: l?.total_minutes || 0,
      };
    });

    if (q.interest) list = list.filter((x) => x.interests && x.interests.includes(q.interest));
    if (q.language) list = list.filter((x) => x.languages && x.languages.includes(q.language));
    if (q.online === '1' && q.favorites === '0') list = list.filter((x) => x.state !== 'offline');

    list.sort((a, b) => order[a.state] - order[b.state] || (b.rating ?? 0) - (a.rating ?? 0) || b._t - a._t);
    return { listeners: list.map(({ _t, ...x }) => x) };
  });

  app.get('/listeners/:id', auth, async (req) => {
    const userId = req.user._id || req.user.id;
    const targetId = req.params.id;

    const [u, l, blocked, fav, state] = await Promise.all([
      User.findOne({ _id: targetId, status: 'active' }).lean(),
      Listener.findOne({ user_id: targetId, approval: 'approved' }).lean(),
      Block.findOne({
        $or: [
          { user_id: userId, blocked_id: targetId },
          { user_id: targetId, blocked_id: userId },
        ],
      }),
      Favorite.findOne({ user_id: userId, listener_id: targetId }),
      listenerState(targetId),
    ]);

    if (!u || !l || blocked) throw new HttpError(404, 'Listener not found.');

    return { ...listenerCard(u, l, state), isFavorite: !!fav };
  });


  app.post('/listeners/:id/favorite', auth, async (req) => {
    const userId = req.user._id || req.user.id;
    const targetId = req.params.id;
    const { on } = z.object({ on: z.boolean() }).parse(req.body);

    if (on) {
      await Favorite.updateOne({ user_id: userId, listener_id: targetId }, { user_id: userId, listener_id: targetId }, { upsert: true });
    } else {
      await Favorite.deleteOne({ user_id: userId, listener_id: targetId });
    }
    return { isFavorite: on };
  });
}
