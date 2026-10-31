import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasik-'));
Object.assign(process.env, {
  DATA_DIR: dir, MINUTE_MS: '1000', ADMIN_PHONES: '9000000001', WELCOME_COINS: '12', RING_SECONDS: '2',
  CONNECT_SECONDS: '3', GRACE_SECONDS: '1', EXPO_PUSH: 'off', OTP_SEND_PER_HOUR_IP: '1000', OTP_VERIFY_PER_HOUR_IP: '1000',
});
const { buildApp } = await import('../src/app.js');
const { attachRealtime } = await import('../src/realtime.js');
const { config } = await import('../src/config.js');

let app, base, wss;
before(async () => {
  app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  wss = attachRealtime(app.server);
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { wss.clients.forEach((c) => c.terminate()); wss.close(); app.server.closeAllConnections(); await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const api = async (method, url, { token, body, form } = {}) => {
  const r = await fetch(base + url, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};
const login = async (phone) => {
  const s = await api('POST', '/auth/otp/send', { body: { phone } });
  assert.equal(s.status, 200);
  const v = await api('POST', '/auth/otp/verify', { body: { phone, code: s.data.devOtp } });
  assert.equal(v.status, 200);
  return v.data;
};
const file = (bytes, type, name) => { const f = new FormData(); f.append('file', new Blob([Buffer.from(bytes)], { type }), name); return f; };
const JPG = [0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(1)];
const MP4 = [0, 0, 0, 0x18, ...Buffer.from('ftypmp42'), ...new Array(40).fill(2)];

class Client {
  constructor(token) { this.msgs = []; this.waiters = []; this.token = token; }
  async open() {
    this.ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    this.ws.on('message', (d) => { const m = JSON.parse(d); this.msgs.push(m); this.waiters = this.waiters.filter((w) => !w(m)); });
    await new Promise((r) => this.ws.on('open', r));
    this.send({ t: 'auth', token: this.token });
    await this.next('auth:ok');
    return this;
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  next(t, ms = 5000) {
    const found = this.msgs.findIndex((m) => m.t === t);
    if (found >= 0) return Promise.resolve(this.msgs.splice(found, 1)[0]);
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(`timeout waiting for ${t}; got ${this.msgs.map((m) => m.t)}`)), ms);
      this.waiters.push((m) => { if (m.t === t) { clearTimeout(to); this.msgs.splice(this.msgs.indexOf(m), 1); res(m); return true; } return false; });
    });
  }
}

const state = {};

test('OTP: validation, wrong code lockout, indian numbers only', async () => {
  assert.equal((await api('POST', '/auth/otp/send', { body: { phone: '12345' } })).status, 400);
  assert.equal((await api('POST', '/auth/otp/send', { body: { phone: '5555555555' } })).status, 400);
  const s = await api('POST', '/auth/otp/send', { body: { phone: '9111111111' } });
  for (let i = 0; i < 5; i++) assert.equal((await api('POST', '/auth/otp/verify', { body: { phone: '9111111111', code: '000000' === s.data.devOtp ? '111111' : '000000' } })).status, 400);
  const locked = await api('POST', '/auth/otp/verify', { body: { phone: '9111111111', code: s.data.devOtp } });
  assert.equal(locked.status, 429, 'correct OTP rejected after 5 wrong attempts');
});

test('onboarding: 18+ enforced, gender locked after set, interests required', async () => {
  const a = await login('9222222222');
  state.tmp = a.accessToken;
  let r = await api('PUT', '/me/onboarding', { token: a.accessToken, body: { gender: 'male', name: 'Kid', age: 17, interests: ['Music', 'Movies', 'Travel'] } });
  assert.equal(r.status, 400); assert.match(r.data.error, /18/);
  r = await api('PUT', '/me/onboarding', { token: a.accessToken, body: { gender: 'male', name: 'Test', age: 25, interests: ['Music'] } });
  assert.equal(r.status, 400);
  r = await api('PUT', '/me/onboarding', { token: a.accessToken, body: { gender: 'male', name: 'Test', age: 25, interests: ['Music', 'Movies', 'Travel'] } });
  assert.equal(r.status, 200); assert.equal(r.data.coins, 12, 'welcome coins');
  r = await api('PUT', '/me/onboarding', { token: a.accessToken, body: { gender: 'female', name: 'Test', age: 25, interests: ['Music', 'Movies', 'Travel'] } });
  assert.equal(r.status, 409, 'gender cannot be changed');
});

test('female: cannot go online or be listed before approval; upload validation', async () => {
  const f = await login('9333333333');
  state.f = f.accessToken;
  let r = await api('PUT', '/me/onboarding', { token: f.accessToken, body: { gender: 'female', name: 'Riya', age: 23, interests: ['Music', 'Poetry', 'Travel'] } });
  assert.equal(r.data.listener.approval, 'none');
  assert.equal(r.data.coins, 0);
  assert.equal((await api('PUT', '/listener/settings', { token: f.accessToken, body: { isAvailable: true } })).status, 403);
  assert.equal((await api('POST', '/listener/verification/submit', { token: f.accessToken })).status, 400, 'cannot submit incomplete');
  // fake file disguised as image is rejected by magic-byte sniffing
  assert.equal((await api('POST', '/me/avatar', { token: f.accessToken, form: file([...Buffer.from('<html>not an image</html>')], 'image/jpeg', 'x.jpg') })).status, 415);
  assert.equal((await api('POST', '/me/avatar', { token: f.accessToken, form: file(JPG, 'image/jpeg', 'a.jpg') })).status, 200);
  assert.equal((await api('POST', '/listener/verification/video', { token: f.accessToken, form: file(MP4, 'video/mp4', 'v.mp4') })).status, 200);
  assert.equal((await api('POST', '/listener/verification/voice', { token: f.accessToken, form: file(MP4, 'audio/mp4', 'v.m4a') })).status, 200);
  r = await api('POST', '/listener/verification/submit', { token: f.accessToken });
  assert.equal(r.data.approval, 'pending');
  const ver = await api('GET', '/listener/verification', { token: f.accessToken });
  assert.match(ver.data.challenge, /^\d{4}$/);
});

test('admin: only admins approve; male cannot see pending listener', async () => {
  const m = await login('9444444444');
  state.m = m.accessToken;
  await api('PUT', '/me/onboarding', { token: m.accessToken, body: { gender: 'male', name: 'Arjun', age: 27, interests: ['Cricket', 'Gaming', 'Music'] } });
  assert.equal((await api('GET', '/admin/verifications', { token: m.accessToken })).status, 403);
  assert.equal((await api('GET', '/listeners?online=0', { token: m.accessToken })).data.listeners.length, 0);
  const adm = await login('9000000001');
  assert.equal(adm.user.role, 'admin');
  state.admin = adm.accessToken;
  const q = await api('GET', '/admin/verifications', { token: adm.accessToken });
  assert.equal(q.data.items.length, 1);
  const fid = q.data.items[0].id;
  state.fid = fid;
  assert.equal((await api('POST', `/admin/verifications/${fid}/approve`, { token: adm.accessToken })).status, 200);
  // listener sets availability and a rate above her tier cap -> rejected
  assert.equal((await api('PUT', '/listener/settings', { token: state.f, body: { voiceRate: 50 } })).status, 400);
  const ok = await api('PUT', '/listener/settings', { token: state.f, body: { isAvailable: true, voiceRate: 5, videoRate: 10, style: 'girlfriend', upiId: 'riya@okaxis' } });
  assert.equal(ok.status, 200);
});

test('payments: mock order credits once (idempotent); forged verify and webhook rejected', async () => {
  const before = (await api('GET', '/wallet', { token: state.m })).data.coins;
  assert.equal(before, 12);
  const o = await api('POST', '/wallet/orders', { token: state.m, body: { packId: 'p99' } });
  assert.equal(o.status, 200);
  const orderId = o.data.orderId;
  await fetch(`${base}/pay/${orderId}/mock`, { method: 'POST' });
  await fetch(`${base}/pay/${orderId}/mock`, { method: 'POST' });
  assert.equal((await api('GET', '/wallet', { token: state.m })).data.coins, 12 + 110, 'credited exactly once');
  assert.equal((await api('POST', '/wallet/verify', { body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_x', razorpay_signature: 'deadbeef' } })).status, 400);
  assert.equal((await api('POST', '/wallet/webhook', { body: { event: 'payment.captured' } })).status, 400);
  assert.equal((await api('POST', '/wallet/orders', { token: state.f, body: { packId: 'p99' } })).status, 403, 'women cannot buy coins');
});

test('discovery: male sees listener only when she has a live connection', async () => {
  let r = await api('GET', '/listeners', { token: state.m });
  assert.equal(r.data.listeners.length, 0, 'available but not connected = not shown online');
  state.fc = await new Client(state.f).open();
  r = await api('GET', '/listeners', { token: state.m });
  assert.equal(r.data.listeners.length, 1);
  assert.equal(r.data.listeners[0].state, 'online');
  assert.equal(r.data.listeners[0].style, 'girlfriend');
  assert.ok(!('phone' in r.data.listeners[0]) && !('upiId' in r.data.listeners[0]), 'no private fields leak');
  assert.equal((await api('GET', '/listeners', { token: state.f })).status, 403);
});

test('LIVE CALL: signaling relay, both-sides-connected billing, per-minute charge, listener earnings', async () => {
  const mc = await new Client(state.m).open();
  state.mc = mc;
  mc.send({ t: 'call:request', listenerId: state.fid, type: 'voice', ref: 1 });
  const ringing = await mc.next('call:ringing');
  const inc = await state.fc.next('call:incoming');
  assert.equal(inc.callId, ringing.callId);
  assert.equal(inc.from.name, 'Arjun');
  // second caller sees her busy
  const m2 = await login('9555555555');
  await api('PUT', '/me/onboarding', { token: m2.accessToken, body: { gender: 'male', name: 'Other', age: 30, interests: ['Cricket', 'Gaming', 'Music'] } });
  const c2 = await new Client(m2.accessToken).open();
  c2.send({ t: 'call:request', listenerId: state.fid, type: 'voice' });
  assert.equal((await c2.next('error')).code, 'busy');
  c2.ws.close();

  state.fc.send({ t: 'call:accept', callId: inc.callId });
  const [a1, a2] = await Promise.all([mc.next('call:accepted'), state.fc.next('call:accepted')]);
  assert.equal(a1.role, 'caller'); assert.equal(a2.role, 'callee');
  assert.ok(a1.iceServers.length >= 1);
  mc.send({ t: 'call:signal', callId: inc.callId, data: { sdp: 'offer' } });
  assert.deepEqual((await state.fc.next('call:signal')).data, { sdp: 'offer' });

  // billing must NOT start until both sides confirm media
  mc.send({ t: 'call:connected', callId: inc.callId });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await api('GET', '/wallet', { token: state.m })).data.coins, 122, 'no charge yet');
  state.fc.send({ t: 'call:connected', callId: inc.callId });
  const started = await mc.next('call:started');
  assert.equal(started.balance, 117, 'minute 1 charged');
  const lstart = await state.fc.next('call:started');
  assert.equal(lstart.earnedPaise, 5 * 45);

  mc.send({ t: 'call:chat', callId: inc.callId, text: 'hello 😊' });
  assert.equal((await state.fc.next('call:chat')).text, 'hello 😊');
  await new Promise((r) => setTimeout(r, 450));
  mc.send({ t: 'call:chat', callId: inc.callId, text: 'whatsapp me on 98765 43210' });
  assert.equal((await mc.next('error')).code, 'contact_blocked', 'off-platform contact sharing blocked');

  const billed = await mc.next('call:billed', 3000);
  assert.equal(billed.minutes, 2); assert.equal(billed.balance, 112);
  mc.send({ t: 'call:end', callId: inc.callId });
  const ended = await mc.next('call:ended');
  const lended = await state.fc.next('call:ended');
  assert.equal(ended.coins, 10); assert.equal(ended.balance, 112);
  assert.equal(lended.earnedPaise, 10 * 45);
  assert.equal((await api('GET', '/wallet', { token: state.m })).data.coins, 112);
  assert.equal((await api('POST', `/calls/${inc.callId}/rate`, { token: state.m, body: { rating: 5 } })).status, 200);
  assert.equal((await api('POST', `/calls/${inc.callId}/rate`, { token: state.m, body: { rating: 1 } })).status, 409, 'rate once');
  const e = await api('GET', '/listener/earnings', { token: state.f });
  assert.equal(e.data.balancePaise, 450);
  state.mc.ws.close();
});

test('LOW BALANCE: call auto-ends when caller cannot afford next minute; no negative balance', async () => {
  const m3 = await login('9666666666');
  await api('PUT', '/me/onboarding', { token: m3.accessToken, body: { gender: 'male', name: 'Poor', age: 22, interests: ['Cricket', 'Gaming', 'Music'] } });
  // 12 welcome coins; voice = 5/min -> 2 minutes affordable, 3rd fails
  const c = await new Client(m3.accessToken).open();
  const f = state.fc;
  c.send({ t: 'call:request', listenerId: state.fid, type: 'voice' });
  const inc = await f.next('call:incoming');
  f.send({ t: 'call:accept', callId: inc.callId });
  await c.next('call:accepted');
  c.send({ t: 'call:connected', callId: inc.callId }); f.send({ t: 'call:connected', callId: inc.callId });
  await c.next('call:started');
  const low = await c.next('call:low_balance', 4000);
  assert.ok(low.secondsLeft <= 1);
  const end = await c.next('call:ended', 4000);
  assert.equal(end.reason, 'insufficient_coins');
  assert.equal(end.coins, 10); assert.equal(end.balance, 2);
  await f.next('call:ended');
  c.ws.close();
});

test('video call needs video-rate coins; unanswered ring -> missed with no charge; reject flow', async () => {
  const m3 = await login('9666666666');
  const c = await new Client(m3.accessToken).open();
  c.send({ t: 'call:request', listenerId: state.fid, type: 'video' });
  assert.equal((await c.next('error')).code, 'insufficient_coins');
  // top up to enable a call, then let it ring out
  const o = await api('POST', '/wallet/orders', { token: m3.accessToken, body: { packId: 'p49' } });
  await fetch(`${base}/pay/${o.data.orderId}/mock`, { method: 'POST' });
  assert.equal((await c.next('wallet')).coins, 52, 'balance pushed live to the app after payment');
  c.send({ t: 'call:request', listenerId: state.fid, type: 'video' });
  await c.next('call:ringing');
  const e1 = await c.next('call:ended', 4000);
  assert.equal(e1.reason, 'no_answer'); assert.equal(e1.coins, 0); assert.equal(e1.balance, 52);
  await state.fc.next('call:incoming'); await state.fc.next('call:ended');
  c.send({ t: 'call:request', listenerId: state.fid, type: 'video' });
  const r = await c.next('call:ringing');
  const inc = await state.fc.next('call:incoming');
  state.fc.send({ t: 'call:reject', callId: inc.callId });
  assert.equal((await c.next('call:ended')).reason, 'rejected');
  await state.fc.next('call:ended');
  c.ws.close();
});

test('disconnect mid-call ends it after grace period; listener goes offline when socket drops', async () => {
  const m = await login('9444444444');
  const c = await new Client(m.accessToken).open();
  c.send({ t: 'call:request', listenerId: state.fid, type: 'voice' });
  const inc = await state.fc.next('call:incoming');
  state.fc.send({ t: 'call:accept', callId: inc.callId });
  await c.next('call:accepted');
  c.send({ t: 'call:connected', callId: inc.callId }); state.fc.send({ t: 'call:connected', callId: inc.callId });
  await c.next('call:started');
  c.ws.terminate();
  const ended = await state.fc.next('call:ended', 5000);
  assert.equal(ended.reason, 'peer_disconnected');
  state.fc.ws.close();
  await new Promise((r) => setTimeout(r, 200));
  const s = await api('GET', '/listeners?online=0', { token: m.accessToken });
  assert.equal(s.data.listeners[0].state, 'offline');
});

test('payouts: min amount, balance check, single open request, admin reject refunds', async () => {
  // give her enough balance via direct DB credit to test the money rules
  const { run } = await import('../src/db.js');
  run('UPDATE listeners SET balance_paise = 50000 WHERE user_id = ?', state.fid);
  assert.equal((await api('POST', '/listener/payouts', { token: state.f, body: { amountPaise: 100 } })).status, 400);
  assert.equal((await api('POST', '/listener/payouts', { token: state.f, body: { amountPaise: 99999999 } })).status, 400);
  const p = await api('POST', '/listener/payouts', { token: state.f, body: { amountPaise: 30000 } });
  assert.equal(p.status, 200);
  assert.equal((await api('POST', '/listener/payouts', { token: state.f, body: { amountPaise: 20000 } })).status, 409);
  assert.equal((await api('GET', '/listener/earnings', { token: state.f })).data.balancePaise, 20000);
  assert.equal((await api('POST', `/admin/payouts/${p.data.id}/reject`, { token: state.admin, body: { note: 'UPI invalid' } })).status, 200);
  assert.equal((await api('GET', '/listener/earnings', { token: state.f })).data.balancePaise, 50000, 'refunded');
});

test('safety: block hides listener both ways and blocks calls; unauthenticated access denied', async () => {
  assert.equal((await api('GET', '/me')).status, 401);
  assert.equal((await api('GET', '/wallet', { token: 'garbage' })).status, 401);
  const m = await login('9444444444');
  await api('POST', '/safety/block', { token: m.accessToken, body: { userId: state.fid } });
  assert.equal((await api('GET', '/listeners?online=0', { token: m.accessToken })).data.listeners.length, 0);
  assert.equal((await api('GET', `/listeners/${state.fid}`, { token: m.accessToken })).status, 404);
  assert.equal((await api('POST', '/safety/report', { token: m.accessToken, body: { targetId: state.fid, reason: 'rude' } })).status, 200);
  assert.equal((await api('GET', '/admin/reports', { token: state.admin })).data.items.length, 1);
});

test('token refresh rotates and old refresh token dies; banned users are locked out', async () => {
  const a = await login('9777777777');
  const r1 = await api('POST', '/auth/refresh', { body: { refreshToken: a.refreshToken } });
  assert.equal(r1.status, 200);
  assert.equal((await api('POST', '/auth/refresh', { body: { refreshToken: a.refreshToken } })).status, 401, 'reuse rejected');
  await api('POST', `/admin/users/${a.user.id}/ban`, { token: state.admin });
  assert.equal((await api('GET', '/me', { token: r1.data.accessToken })).status, 401);
});
