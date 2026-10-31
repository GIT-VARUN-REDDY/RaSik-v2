import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { HttpError } from '../auth.js';
import { User, Order, WalletTx, uid, now, creditCoins } from '../db.js';
import { pushBalance } from '../realtime.js';

const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

/** Idempotently credit an order. Safe to call from verify, webhook and mock-pay, in any order or repeatedly. */
async function fulfil(orderId, paymentId) {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, status: { $ne: 'paid' } },
    { $set: { status: 'paid', payment_id: paymentId } },
    { new: true }
  );
  if (!order) {
    const existing = await Order.findById(orderId).lean();
    return existing ? { order: existing, credited: false } : null;
  }
  await creditCoins(order.user_id, order.coins, 'recharge', orderId, order.amount_paise);
  pushBalance(order.user_id);
  return { order, credited: true };
}

export default async function (app) {
  const auth = { preHandler: app.auth };

  app.get('/wallet', auth, async (req) => {
    const u = await User.findById(req.user.id, { coins: 1 }).lean();
    const historyDocs = await WalletTx.find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(50).lean();
    const history = historyDocs.map((t) => ({
      id: t._id,
      kind: t.kind,
      coins: t.coins,
      amountPaise: t.amount_paise,
      createdAt: t.created_at,
    }));
    return { coins: u?.coins || 0, packs: config.economy.packs, history };
  });

  app.post('/wallet/orders', auth, async (req) => {
    const { packId } = z.object({ packId: z.string() }).parse(req.body);
    const pack = config.economy.packs.find((p) => p.id === packId);
    if (!pack) throw new HttpError(400, 'Unknown pack.');
    if (req.user.gender !== 'male') throw new HttpError(403, 'Members only.');
    const amountPaise = pack.priceInr * 100;
    let orderId;
    if (config.mockPayments) {
      orderId = uid('order_mock_');
    } else {
      const r = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64') },
        body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: uid('r_'), notes: { userId: req.user.id, packId } }),
      });
      if (!r.ok) { req.log.error({ status: r.status }, 'razorpay order failed'); throw new HttpError(502, 'Payment service unavailable. Try again.'); }
      orderId = (await r.json()).id;
    }
    await Order.create({
      _id: orderId,
      user_id: req.user.id,
      pack_id: pack.id,
      coins: pack.coins,
      amount_paise: amountPaise,
      created_at: now(),
    });
    return { orderId, payUrl: `${config.publicUrl}/pay/${orderId}`, amountPaise, coins: pack.coins };
  });

  // Hosted checkout page, opened in the in-app browser. Contains no secrets and no user data.
  app.get('/pay/:orderId', async (req, reply) => {
    const o = await Order.findById(req.params.orderId).lean();
    if (!o) return reply.code(404).send('Order not found');
    const mock = config.mockPayments;
    reply.header('content-security-policy', "default-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://*.razorpay.com; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; frame-src https://api.razorpay.com https://*.razorpay.com; connect-src 'self' https://*.razorpay.com; style-src 'self' 'unsafe-inline'; img-src * data:");
    return reply.type('text/html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>RaSik Pay</title>
<style>body{font-family:system-ui;background:#0f0a14;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.c{text-align:center;padding:24px}button{background:linear-gradient(90deg,#ff4d8d,#ff7a59);color:#fff;border:0;border-radius:28px;padding:16px 36px;font-size:18px;font-weight:700}</style></head>
<body><div class="c"><h2>${o.coins} coins</h2><p>₹${o.amount_paise / 100}</p><p id="s">${o.status === 'paid' ? 'Payment complete ✓ You can close this window.' : ''}</p>
${o.status === 'paid' ? '' : `<button id="b">${mock ? 'Pay (test mode)' : 'Pay securely'}</button>`}</div>
${mock ? '' : '<script src="https://checkout.razorpay.com/v1/checkout.js"></script>'}
<script>
var s=document.getElementById('s'),b=document.getElementById('b');
function done(){s.textContent='Payment complete ✓ You can close this window.';if(b)b.remove();}
if(b)b.onclick=function(){
${mock ? `fetch('/pay/${o._id}/mock',{method:'POST'}).then(function(r){return r.ok?done():(s.textContent='Failed')});`
: `new Razorpay({key:${JSON.stringify(config.razorpay.keyId)},order_id:${JSON.stringify(o._id)},name:'RaSik',description:'${o.coins} coins',theme:{color:'#ff4d8d'},
handler:function(r){fetch('/wallet/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(r)}).then(function(x){x.ok?done():s.textContent='Verifying… your coins will appear shortly.'})}}).open();`}
};
</script></body></html>`);
  });

  app.post('/pay/:orderId/mock', async (req) => {
    if (!config.mockPayments) throw new HttpError(404, 'Not found');
    await fulfil(req.params.orderId, 'mock_' + uid());
    return { ok: true };
  });

  // Signature proves the payment is genuine, so no login is needed (works from the hosted page).
  app.post('/wallet/verify', async (req) => {
    const b = z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }).parse(req.body);
    if (!safeEq(hmac(config.razorpay.keySecret, `${b.razorpay_order_id}|${b.razorpay_payment_id}`), b.razorpay_signature)) throw new HttpError(400, 'Invalid payment signature.');
    await fulfil(b.razorpay_order_id, b.razorpay_payment_id);
    return { ok: true };
  });

  // Source of truth even if the user closes the app mid-payment.
  app.post('/wallet/webhook', { config: { rawBody: true } }, async (req) => {
    const sig = req.headers['x-razorpay-signature'];
    if (!config.razorpay.webhookSecret || !sig || !safeEq(hmac(config.razorpay.webhookSecret, req.rawBody), String(sig))) throw new HttpError(400, 'Bad signature');
    const ev = JSON.parse(req.rawBody);
    if (['payment.captured', 'order.paid'].includes(ev.event)) {
      const pay = ev.payload?.payment?.entity;
      if (pay?.order_id) await fulfil(pay.order_id, pay.id);
    }
    return { ok: true };
  });

  app.get('/wallet/orders/:id', auth, async (req) => {
    const o = await Order.findOne({ _id: req.params.id, user_id: req.user.id }, { status: 1, coins: 1 }).lean();
    if (!o) throw new HttpError(404, 'Order not found');
    return o;
  });
}
