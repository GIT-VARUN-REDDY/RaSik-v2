# RaSik v2 — live voice & video calls: women earn, men pay

```
backend/   Node.js (ESM, Fastify, WebSocket, SQLite) — API, call/billing engine, admin panel at /admin/
app/       Expo SDK 58 / React Native — one app, two experiences (men / women), real WebRTC calls
docker-compose.yml + Caddyfile   API + auto-HTTPS + TURN relay on one server
```

## How the product works
1. **Sign in** with mobile number → OTP (Indian numbers only) → choose Man / Woman (locked forever) → name, age 18+, interests.
2. **Women** must be approved first: live photo + a 10-second video where she reads a random 4-digit code aloud (proves face *and* voice, can't be reused) + a voice intro. Admin reviews in `/admin/` and approves/rejects with a reason. Only approved women can go online or appear anywhere.
3. **Men** get 12 free coins, then see online women as photo-first cards in three vibes: 💕 Girlfriend, 🤝 Friend, 🎧 Listener. They can hear her voice intro, favourite her, then call by **voice or video**.
4. **Call screen**: full-screen video + small self-view, mute, camera on/off, flip camera, speaker, end, and a small transparent chat at bottom-right.
5. **Money**: men buy coins (Razorpay: UPI/cards). Calls are billed **per minute, prepaid, by the server**. Women earn ₹ per coin spent (default ₹0.45) and withdraw to UPI (min ₹200); you pay them from `/admin/` and enter the UTR.

## Run it locally (5 minutes)
```bash
cd backend && npm install && npm start      # OTP prints in the console, payments are MOCK in dev
cd app && cp .env.example .env              # set EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:5001
npm install && npx expo prebuild && npx expo run:android   # or run:ios
```
**Expo Go will not work** — WebRTC is native, so you need a development build (`expo run:android`, or `eas build --profile development`).
Make yourself admin: `ADMIN_PHONES=98xxxxxxxx` in `backend/.env`, log in at `http://localhost:5001/admin/`.
Tests: `cd backend && npm test` (13 end-to-end tests: auth, uploads, approval, payments, live call billing, low balance, disconnects, payouts, blocking).

## Go-live checklist (do these before real users)
| # | Task | Why |
|---|------|-----|
| 1 | **Rotate every key from the old project** — OpenRouter key in `server/config.js`, anything in the old `.env`s, the DB password in docker-compose. Never ship keys in `EXPO_PUBLIC_*`. | They were in the zip you shared. |
| 2 | Copy `backend/.env.example` → `.env`; set `JWT_SECRET` (`openssl rand -base64 48`), `PUBLIC_URL`, `ADMIN_PHONES`. | Server refuses to start in production without secrets. |
| 3 | **MSG91** account + DLT-registered OTP template → `MSG91_*`. | TRAI requires DLT for Indian SMS. |
| 4 | **Razorpay** live keys + webhook to `PUBLIC_URL/wallet/webhook` (events `payment.captured`, `order.paid`) → `RAZORPAY_*`. | Coins are credited by webhook even if the app is closed. |
| 5 | **TURN server** (coturn is in docker-compose) → `TURN_URLS`, `TURN_SECRET`. | Without TURN, many calls on Indian mobile data will not connect. |
| 6 | Deploy: `docker compose up -d` on a VPS (Mumbai region), point DNS, edit `Caddyfile`. | HTTPS is mandatory for mobile apps. |
| 7 | `eas init` → put the project id in `app.json`; `eas build -p android --profile production`. Add FCM credentials for push. | Store builds + incoming-call push. |
| 8 | Write Terms, Privacy Policy, grievance officer details; register the business; GST on coin sales; TDS on payouts; KYC (PAN) for women above thresholds. Talk to a CA. | Legal requirement in India; stores reject apps without them. |

## What I changed from your original project, and why
- **Calls were simulated** (a text-to-speech "listener"). Now real peer-to-peer WebRTC audio/video with TURN.
- **Billing trusted the phone** (`/calls/complete` accepted any `coinsBurned`). Now the server starts billing only when *both* devices confirm media, charges minute-by-minute from the DB wallet, and ends the call when coins run out. Clients cannot affect charges.
- **Secrets exposed** (OpenRouter key hardcoded and shipped inside the app, default JWT secret). Removed; production refuses to boot without real secrets.
- **JSON-file database, no rate limits.** Replaced with SQLite (WAL, transactions, constraints so balances can never go negative), OTP lockouts, refresh-token rotation, per-IP limits.
- **Seeded fake profiles / AI companion / lounges / mock coins** removed. Everything shown is a real approved person.

## Protection built in
Magic-byte upload checks • verification video is private (admin only) • new profile photo re-triggers review • contact-sharing (phone/WhatsApp/UPI/links) is blocked in call chat to stop off-platform leakage • report/block • ban • 18+ gate • account deletion (store requirement) • admin can read chat of reported calls.

## Honest limits (known, not hidden)
- **SQLite + in-memory presence = one server.** Fine to launch and well into thousands of concurrent users. To scale horizontally, move to Postgres + Redis pub/sub (the DB layer is isolated in `db.js`).
- **Incoming call while the app is fully closed** needs a native full-screen call UI (CallKit / ConnectionService). Today it sends a high-priority push and the call rings when she opens the app. This is the first thing to add after launch.
- **Payouts are manual** (admin pays UPI, enters UTR). Automate later with Razorpay X / Cashfree Payouts once volumes justify it.
- Face matching is **human review**, not automated. Add a liveness vendor (e.g. Digio, IDfy) when volume grows.
- No in-app persistent DMs yet — only chat during calls. Favourites and recents are there.
- Gallery photos are not exposed (they would need moderation first); the DB field exists.
- I could not run the app on a physical phone from here: it type-checks, bundles for Android, and the entire server protocol it speaks is covered by the 13 passing tests. Do a two-phone test (one man, one woman) before launch.

## Unit economics (defaults, all tunable in `.env`)
Coin packs average ≈ ₹0.90/coin. After 18% GST and ~2% gateway fee ≈ ₹0.74. Women earn ₹0.45/coin → you keep ≈ ₹0.29/coin (~39%). A 10-minute voice call at 6🪙/min = 60 coins ≈ ₹54 from the man, ₹27 to her, ≈ ₹17 to you.
Fastest path to revenue: get 20–50 verified women online in the 7–11 PM window, then spend on acquiring men — supply of women online is what converts.

## Policy note
Keep listing text and the "Girlfriend vibe" label about companionship and conversation. Sexual content, nudity, or paying for explicit chat violates Google Play and App Store policies and Indian law, and will get the app removed. The call chat filter and report flow exist to help enforce this.
