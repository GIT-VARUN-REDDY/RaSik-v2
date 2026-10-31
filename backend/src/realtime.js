/**
 * Real-time engine: presence, call lifecycle, WebRTC signaling relay, in-call chat and billing.
 *
 * Billing is 100% server-authoritative and prepaid per minute:
 *   - Both devices must report "media connected" before billing starts.
 *   - Minute N is charged at the start of that minute; if the caller cannot afford it, the call ends.
 *   - Clients never tell the server how much to charge.
 */
import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { config } from './config.js';
import { User, Listener, Call, CallMessage, Block, uid, now, debitCoins } from './db.js';
import { userFromToken } from './auth.js';
import { mediaUrl, expoPush, hasContactInfo } from './util.js';

const sockets = new Map();   // userId -> Set<ws>
const calls = new Map();     // callId -> call state
const userCall = new Map();  // userId -> callId
const graceTimers = new Map();

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const sendUser = (userId, msg) => sockets.get(userId)?.forEach((ws) => send(ws, msg));

function iceServers(userId) {
  const list = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
      ],
    },
  ];
  if (config.webrtc.turnUrls.length && config.webrtc.turnSecret) {
    const username = `${Math.floor(Date.now() / 1000) + 4 * 3600}:${userId}`;
    const credential = crypto.createHmac('sha1', config.webrtc.turnSecret).update(username).digest('base64');
    list.push({ urls: config.webrtc.turnUrls, username, credential });
  }
  return list;
}

export const isUserOnline = (userId) => {
  const set = sockets.get(String(userId));
  return !!(set && set.size > 0);
};

export async function listenerState(userId) {
  const uid = String(userId);
  const l = await Listener.findOne({ user_id: uid }, { approval: 1, is_available: 1 }).lean();
  if (!l || l.approval !== 'approved' || !l.is_available) return 'offline';
  if (userCall.has(uid)) return 'busy';
  if (isUserOnline(uid)) return 'online';
  const u = await User.findById(uid, { last_seen: 1 }).lean();
  if (u?.last_seen && now() - u.last_seen < 60_000) return 'online';
  return 'offline';
}

export async function broadcastPresence(listenerId) {
  const state = await listenerState(listenerId);
  const msg = { t: 'presence', listenerId, state };
  for (const set of sockets.values()) for (const ws of set) if (ws.user?.gender === 'male') send(ws, msg);
}

export async function pushBalance(userId) {
  const u = await User.findById(userId, { coins: 1 }).lean();
  if (u) sendUser(userId, { t: 'wallet', coins: u.coins });
}

export async function getIncomingCallForUser(userId) {
  const uid = String(userId);
  const cid = userCall.get(uid);
  if (!cid) return null;
  const c = calls.get(cid);
  if (!c || c.status !== 'ringing' || c.listenerId !== uid) return null;
  const caller = await User.findById(c.callerId, { name: 1, avatar: 1, age: 1 }).lean();
  return {
    callId: c.id,
    type: c.type,
    from: { id: c.callerId, name: caller?.name, avatar: mediaUrl(caller?.avatar), age: caller?.age },
    earnPerMinPaise: Math.round(c.rate * config.economy.listenerPaisePerCoin),
    ringSeconds: config.ringSeconds,
  };
}

export const onlineCount = () => sockets.size;
export const isInCall = (userId) => userCall.has(String(userId));

// ---------------------------------------------------------------------------------------------
async function billMinute(c) {
  try {
    const ok = await debitCoins(c.callerId, c.rate, 'call', c.id);
    if (!ok) return false;
    const earn = Math.round(c.rate * config.economy.listenerPaisePerCoin);
    await Promise.all([
      Listener.updateOne(
        { user_id: c.listenerId },
        { $inc: { balance_paise: earn, lifetime_paise: earn } }
      ),
      Call.updateOne(
        { _id: c.id },
        { $inc: { coins: c.rate, earned_paise: earn } }
      ),
    ]);
    c.minutes += 1;
    c.coins += c.rate;
    c.earned += earn;
    return true;
  } catch (e) {
    console.error('[billing] error', e);
    return false;
  }
}

function peerOf(c, userId) { return userId === c.callerId ? c.listenerId : c.callerId; }

async function endCall(c, reason, status) {
  if (c.ended) return;
  c.ended = true;
  clearTimeout(c.ringTimer); clearTimeout(c.connectTimer); clearInterval(c.ticker);
  for (const id of [c.callerId, c.listenerId]) {
    clearTimeout(graceTimers.get(id)); graceTimers.delete(id);
    if (userCall.get(id) === c.id) userCall.delete(id);
  }
  const seconds = c.connectedAt ? Math.max(0, Math.floor((now() - c.connectedAt) / 1000)) : 0;
  const finalStatus = status || (c.connectedAt ? 'completed' : 'failed');
  await Call.updateOne(
    { _id: c.id },
    { $set: { status: finalStatus, ended_at: now(), seconds, end_reason: reason } }
  );
  if (c.connectedAt) {
    await Listener.updateOne(
      { user_id: c.listenerId },
      { $inc: { total_calls: 1, total_minutes: Math.max(1, Math.ceil(seconds / 60)) } }
    );
  }
  const callerUser = await User.findById(c.callerId, { coins: 1 }).lean();
  const balance = callerUser?.coins ?? 0;
  const base = { t: 'call:ended', callId: c.id, reason, seconds, coins: c.coins };
  sendUser(c.callerId, { ...base, balance });
  sendUser(c.listenerId, { ...base, earnedPaise: c.earned });
  calls.delete(c.id);
  broadcastPresence(c.listenerId);
}

async function startBilling(c) {
  c.status = 'active';
  clearTimeout(c.connectTimer);
  c.connectedAt = now();
  await Call.updateOne({ _id: c.id }, { $set: { status: 'active', connected_at: c.connectedAt } });
  if (!(await billMinute(c))) return endCall(c, 'insufficient_coins');
  const u = await User.findById(c.callerId, { coins: 1 }).lean();
  const balance = u?.coins || 0;
  const m = { t: 'call:started', callId: c.id, minutes: c.minutes, rate: c.rate };
  sendUser(c.callerId, { ...m, balance, coins: c.coins });
  sendUser(c.listenerId, { ...m, earnedPaise: c.earned });
  const warnMs = 15_000 * (config.economy.minuteMs / 60_000);
  c.ticker = setInterval(async () => {
    if (c.ended) return;
    const elapsed = now() - c.connectedAt;
    const nextAt = c.minutes * config.economy.minuteMs;
    if (elapsed >= nextAt) {
      if (!(await billMinute(c))) return endCall(c, 'insufficient_coins');
      const balUser = await User.findById(c.callerId, { coins: 1 }).lean();
      const bal = balUser?.coins || 0;
      sendUser(c.callerId, { t: 'call:billed', callId: c.id, minutes: c.minutes, coins: c.coins, balance: bal });
      sendUser(c.listenerId, { t: 'call:billed', callId: c.id, minutes: c.minutes, earnedPaise: c.earned });
    } else if (nextAt - elapsed <= warnMs && !c.warned.has(c.minutes)) {
      c.warned.add(c.minutes);
      const balUser = await User.findById(c.callerId, { coins: 1 }).lean();
      const bal = balUser?.coins || 0;
      if (bal < c.rate) sendUser(c.callerId, { t: 'call:low_balance', callId: c.id, secondsLeft: Math.ceil((nextAt - elapsed) / 1000), balance: bal, need: c.rate });
    }
  }, 250);
}

// ---------------------------------------------------------------------------------------------
const err = (ws, code, message, ref) => send(ws, { t: 'error', code, message, ref });

async function onCallRequest(ws, m) {
  const me = ws.user;
  if (me.gender !== 'male') return err(ws, 'forbidden', 'Only members can place calls.', m.ref);
  if (!['voice', 'video'].includes(m.type)) return err(ws, 'bad_request', 'Invalid call type.', m.ref);
  if (userCall.has(me.id)) return err(ws, 'busy_self', 'You are already in a call.', m.ref);

  const targetUser = await User.findById(String(m.listenerId)).lean();
  const listener = await Listener.findOne({ user_id: String(m.listenerId) }).lean();
  if (!targetUser || !listener || targetUser.status !== 'active' || listener.approval !== 'approved') {
    return err(ws, 'unavailable', 'This listener is not available.', m.ref);
  }

  const blocked = await Block.findOne({
    $or: [
      { user_id: me.id, blocked_id: targetUser._id },
      { user_id: targetUser._id, blocked_id: me.id },
    ],
  }).lean();
  if (blocked) return err(ws, 'unavailable', 'This listener is not available.', m.ref);

  const state = await listenerState(targetUser._id);
  if (state === 'busy') return err(ws, 'busy', `${targetUser.name} is on another call.`, m.ref);
  if (state !== 'online') return err(ws, 'offline', `${targetUser.name} is offline right now.`, m.ref);

  const rate = m.type === 'video' ? listener.video_rate : listener.voice_rate;
  const callerUser = await User.findById(me.id, { coins: 1 }).lean();
  const coins = callerUser?.coins || 0;
  if (coins < rate) return err(ws, 'insufficient_coins', `You need at least ${rate} coins to start this call.`, m.ref);

  const id = uid('c_');
  await Call.create({
    _id: id,
    caller_id: me.id,
    listener_id: targetUser._id,
    type: m.type,
    rate,
    status: 'ringing',
    created_at: now(),
  });

  const c = { id, callerId: me.id, listenerId: targetUser._id, type: m.type, rate, status: 'ringing', minutes: 0, coins: 0, earned: 0, warned: new Set(), ready: new Set() };
  calls.set(id, c);
  userCall.set(me.id, id);
  userCall.set(targetUser._id, id);
  broadcastPresence(targetUser._id);

  const caller = await User.findById(me.id, { name: 1, avatar: 1, age: 1 }).lean();
  const incoming = {
    t: 'call:incoming',
    callId: id,
    type: m.type,
    from: { id: me.id, name: caller?.name, avatar: mediaUrl(caller?.avatar), age: caller?.age },
    earnPerMinPaise: Math.round(rate * config.economy.listenerPaisePerCoin),
    ringSeconds: config.ringSeconds,
  };

  if (sockets.has(targetUser._id)) sockets.get(targetUser._id).forEach((s) => send(s, incoming));
  else expoPush(targetUser.push_token, `${caller?.name || 'Someone'} is calling`, `Incoming ${m.type} call`, { callId: id });

  send(ws, {
    t: 'call:ringing',
    callId: id,
    ref: m.ref,
    type: m.type,
    rate,
    peer: { id: targetUser._id, name: targetUser.name, avatar: mediaUrl(targetUser.avatar) },
    ringSeconds: config.ringSeconds,
  });

  c.ringTimer = setTimeout(() => {
    if (c.status === 'ringing') endCall(c, 'no_answer', 'missed');
  }, config.ringSeconds * 1000);
}

async function onAccept(ws, m) {
  const c = calls.get(m.callId);
  if (!c || c.listenerId !== ws.user.id || c.status !== 'ringing') return;
  clearTimeout(c.ringTimer);
  c.status = 'connecting';
  await Call.updateOne({ _id: c.id }, { $set: { status: 'connecting' } });

  const peerInfo = async (id) => {
    const u = await User.findById(id, { name: 1, avatar: 1 }).lean();
    return { id: u?._id, name: u?.name, avatar: mediaUrl(u?.avatar) };
  };

  const [listenerPeer, callerPeer] = await Promise.all([peerInfo(c.listenerId), peerInfo(c.callerId)]);
  sendUser(c.callerId, { t: 'call:accepted', callId: c.id, role: 'caller', type: c.type, peer: listenerPeer, iceServers: iceServers(c.callerId) });
  sendUser(c.listenerId, { t: 'call:accepted', callId: c.id, role: 'callee', type: c.type, peer: callerPeer, iceServers: iceServers(c.listenerId) });
  c.connectTimer = setTimeout(() => { if (c.status === 'connecting') endCall(c, 'connect_failed'); }, config.connectSeconds * 1000);
}

function onSignal(ws, m) {
  const c = calls.get(m.callId);
  if (!c || ![c.callerId, c.listenerId].includes(ws.user.id) || !['connecting', 'active'].includes(c.status)) return;
  if (JSON.stringify(m.data ?? '').length > 30_000) return;
  sendUser(peerOf(c, ws.user.id), { t: 'call:signal', callId: c.id, data: m.data });
}

function onConnected(ws, m) {
  const c = calls.get(m.callId);
  if (!c || ![c.callerId, c.listenerId].includes(ws.user.id) || c.status !== 'connecting') return;
  c.ready.add(ws.user.id);
  if (c.ready.size === 2) startBilling(c);
}

async function onChat(ws, m) {
  const c = calls.get(m.callId);
  if (!c || c.status !== 'active' || ![c.callerId, c.listenerId].includes(ws.user.id)) return;
  const text = String(m.text ?? '').trim().slice(0, 300);
  if (!text) return;
  const t = now();
  if (t - (ws.lastChat || 0) < 400) return;
  ws.lastChat = t;
  if (hasContactInfo(text)) return err(ws, 'contact_blocked', 'Sharing phone numbers, links or social handles is not allowed.', m.ref);
  await CallMessage.create({ call_id: c.id, sender_id: ws.user.id, text, at: t });
  const msg = { t: 'call:chat', callId: c.id, from: ws.user.id, text, at: t };
  sendUser(c.callerId, msg); sendUser(c.listenerId, msg);
}

async function handle(ws, m) {
  switch (m.t) {
    case 'ping': return send(ws, { t: 'pong' });
    case 'call:request': return await onCallRequest(ws, m);
    case 'call:accept': return await onAccept(ws, m);
    case 'call:reject': { const c = calls.get(m.callId); if (c && c.listenerId === ws.user.id && c.status === 'ringing') endCall(c, 'rejected', 'rejected'); return; }
    case 'call:cancel': { const c = calls.get(m.callId); if (c && c.callerId === ws.user.id && ['ringing', 'connecting'].includes(c.status)) endCall(c, 'cancelled', 'cancelled'); return; }
    case 'call:signal': return onSignal(ws, m);
    case 'call:connected': return onConnected(ws, m);
    case 'call:chat': return await onChat(ws, m);
    case 'call:end': { const c = calls.get(m.callId); if (c && [c.callerId, c.listenerId].includes(ws.user.id)) endCall(c, ws.user.id === c.callerId ? 'caller_hangup' : 'listener_hangup', c.connectedAt ? 'completed' : (ws.user.id === c.callerId ? 'cancelled' : 'rejected')); return; }
    case 'call:mute_state': {
      const c = calls.get(m.callId);
      if (c && [c.callerId, c.listenerId].includes(ws.user.id)) sendUser(peerOf(c, ws.user.id), { t: 'call:peer_state', callId: c.id, mic: !!m.mic, cam: !!m.cam });
      return;
    }
  }
}

async function onAuthed(ws) {
  const u = ws.user;
  if (!sockets.has(u.id)) sockets.set(u.id, new Set());
  sockets.get(u.id).add(ws);
  clearTimeout(graceTimers.get(u.id)); graceTimers.delete(u.id);
  await User.updateOne({ _id: u.id }, { $set: { last_seen: now() } });
  const userDoc = await User.findById(u.id, { coins: 1 }).lean();
  send(ws, { t: 'auth:ok', userId: u.id, coins: userDoc?.coins || 0 });

  // Resume an in-progress call after a signaling reconnect.
  const cid = userCall.get(u.id);
  const c = cid && calls.get(cid);
  if (c) {
    if (c.status === 'ringing' && c.listenerId === u.id) {
      const caller = await User.findById(c.callerId, { name: 1, avatar: 1, age: 1 }).lean();
      send(ws, { t: 'call:incoming', callId: c.id, type: c.type, from: { id: c.callerId, name: caller?.name, avatar: mediaUrl(caller?.avatar), age: caller?.age }, earnPerMinPaise: Math.round(c.rate * config.economy.listenerPaisePerCoin), ringSeconds: config.ringSeconds });
    } else if (c.status === 'active') {
      send(ws, { t: 'call:resume', callId: c.id, minutes: c.minutes, elapsedMs: now() - c.connectedAt });
    }
  }
  if (u.gender === 'female') broadcastPresence(u.id);
}

async function onClose(ws) {
  const u = ws.user;
  if (!u) return;
  const set = sockets.get(u.id);
  set?.delete(ws);
  if (set && set.size === 0) {
    sockets.delete(u.id);
    await User.updateOne({ _id: u.id }, { $set: { last_seen: now() } });
    const cid = userCall.get(u.id);
    const c = cid && calls.get(cid);
    if (c) {
      if (c.status === 'ringing' && c.callerId === u.id) endCall(c, 'cancelled', 'cancelled');
      else graceTimers.set(u.id, setTimeout(() => endCall(c, 'peer_disconnected'), config.disconnectGraceSeconds * 1000));
    }
    if (u.gender === 'female') broadcastPresence(u.id);
  }
}

export async function attachRealtime(server) {
  // Any call left mid-flight by a previous process is closed out.
  await Call.updateMany(
    { status: { $in: ['ringing', 'connecting', 'active'] } },
    { $set: { status: 'failed', end_reason: 'server_restart', ended_at: now() } }
  );

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    let bucketStart = now(), count = 0;
    const authTimer = setTimeout(() => ws.close(4001, 'auth timeout'), 8000);
    ws.on('message', async (raw) => {
      if (now() - bucketStart > 5000) { bucketStart = now(); count = 0; }
      if (++count > 150) return ws.close(4008, 'rate limit');
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!ws.user) {
        if (m.t !== 'auth') return;
        const u = await userFromToken(String(m.token || ''));
        if (!u || !u.onboarded) { send(ws, { t: 'auth:fail' }); return ws.close(4003, 'unauthorized'); }
        clearTimeout(authTimer);
        const uid = String(u._id || u.id);
        ws.user = { id: uid, _id: uid, gender: u.gender, role: u.role };
        return await onAuthed(ws);
      }
      try { await handle(ws, m); } catch (e) { console.error('[ws] handler error', e); err(ws, 'server', 'Something went wrong.', m.ref); }
    });
    ws.on('close', () => { clearTimeout(authTimer); onClose(ws); });
    ws.on('error', () => {});
  });
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false; ws.ping();
    }
  }, 25_000);
  wss.on('close', () => clearInterval(hb));
  return wss;
}
