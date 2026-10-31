import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { config } from './config.js';

export const uid = (prefix = '') => prefix + crypto.randomBytes(10).toString('hex');
export const now = () => Date.now();
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const json = (s, d = []) => {
  if (Array.isArray(s) || (typeof s === 'object' && s !== null)) return s;
  try { return JSON.parse(s ?? ''); } catch { return d; }
};

export function tierFor(totalMinutes) {
  let cur = config.economy.tiers[0];
  for (const x of config.economy.tiers) if (totalMinutes >= x.minMinutes) cur = x;
  return cur;
}

// ------------------------------------------------------------- Schemas & Models

const UserSchema = new mongoose.Schema({
  _id: { type: String, default: () => uid('u_') },
  phone: { type: String, required: true, unique: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  gender: { type: String, enum: ['male', 'female', null], default: null },
  name: { type: String, default: null },
  age: { type: Number, default: null },
  avatar: { type: String, default: null },
  bio: { type: String, default: '' },
  interests: { type: [String], default: [] },
  languages: { type: [String], default: ['Hindi', 'English'] },
  onboarded: { type: Boolean, default: false },
  coins: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
  push_token: { type: String, default: null },
  last_seen: { type: Number, default: 0 },
  created_at: { type: Number, default: now },
}, { _id: false, timestamps: false, versionKey: false });

UserSchema.virtual('id').get(function () { return this._id; });
UserSchema.set('toJSON', { virtuals: true });
UserSchema.set('toObject', { virtuals: true });

const ListenerSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true, ref: 'User' },
  approval: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
  reject_reason: { type: String, default: null },
  style: { type: String, default: 'friend' },
  voice_rate: { type: Number, default: 5 },
  video_rate: { type: Number, default: 10 },
  is_available: { type: Boolean, default: false },
  challenge: { type: String, default: null },
  video_file: { type: String, default: null },
  voice_file: { type: String, default: null },
  gallery: { type: [String], default: [] },
  rating_sum: { type: Number, default: 0 },
  rating_count: { type: Number, default: 0 },
  total_minutes: { type: Number, default: 0 },
  total_calls: { type: Number, default: 0 },
  balance_paise: { type: Number, default: 0, min: 0 },
  lifetime_paise: { type: Number, default: 0 },
  upi_id: { type: String, default: null },
  submitted_at: { type: Number, default: null },
  reviewed_at: { type: Number, default: null },
}, { versionKey: false });

const CallSchema = new mongoose.Schema({
  _id: { type: String, default: () => uid('c_') },
  caller_id: { type: String, required: true, ref: 'User' },
  listener_id: { type: String, required: true, ref: 'User' },
  type: { type: String, enum: ['voice', 'video'], required: true },
  rate: { type: Number, required: true },
  status: { type: String, required: true },
  created_at: { type: Number, default: now },
  connected_at: { type: Number, default: null },
  ended_at: { type: Number, default: null },
  seconds: { type: Number, default: 0 },
  coins: { type: Number, default: 0 },
  earned_paise: { type: Number, default: 0 },
  end_reason: { type: String, default: null },
  rating: { type: Number, default: null },
}, { _id: false, versionKey: false });

const CallMessageSchema = new mongoose.Schema({
  call_id: { type: String, required: true, index: true },
  sender_id: { type: String, required: true },
  text: { type: String, required: true },
  at: { type: Number, default: now },
}, { versionKey: false });

const WalletTxSchema = new mongoose.Schema({
  _id: { type: String, default: () => uid('tx_') },
  user_id: { type: String, required: true, index: true, ref: 'User' },
  kind: { type: String, required: true },
  coins: { type: Number, required: true },
  amount_paise: { type: Number, default: 0 },
  ref: { type: String, default: null },
  created_at: { type: Number, default: now },
}, { _id: false, versionKey: false });

const OrderSchema = new mongoose.Schema({
  _id: { type: String, default: () => uid('ord_') },
  user_id: { type: String, required: true, index: true, ref: 'User' },
  pack_id: { type: String, required: true },
  coins: { type: Number, required: true },
  amount_paise: { type: Number, required: true },
  status: { type: String, default: 'created' },
  payment_id: { type: String, default: null },
  created_at: { type: Number, default: now },
}, { _id: false, versionKey: false });

const PayoutSchema = new mongoose.Schema({
  _id: { type: String, default: () => uid('pay_') },
  listener_id: { type: String, required: true, index: true, ref: 'User' },
  amount_paise: { type: Number, required: true },
  upi_id: { type: String, required: true },
  status: { type: String, default: 'requested' },
  note: { type: String, default: null },
  created_at: { type: Number, default: now },
  processed_at: { type: Number, default: null },
}, { _id: false, versionKey: false });

const ReportSchema = new mongoose.Schema({
  _id: { type: String, default: () => uid('rep_') },
  reporter_id: { type: String, required: true },
  target_id: { type: String, required: true },
  call_id: { type: String, default: null },
  reason: { type: String, required: true },
  status: { type: String, default: 'open' },
  created_at: { type: Number, default: now },
}, { _id: false, versionKey: false });

const BlockSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  blocked_id: { type: String, required: true },
}, { versionKey: false });
BlockSchema.index({ user_id: 1, blocked_id: 1 }, { unique: true });

const FavoriteSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  listener_id: { type: String, required: true },
}, { versionKey: false });
FavoriteSchema.index({ user_id: 1, listener_id: 1 }, { unique: true });

const OtpSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  code_hash: { type: String, required: true },
  expires_at: { type: Number, required: true },
  attempts: { type: Number, default: 0 },
  sends: { type: [Number], default: [] },
}, { versionKey: false });

const SessionSchema = new mongoose.Schema({
  _id: { type: String, default: () => uid('ses_') },
  user_id: { type: String, required: true, index: true, ref: 'User' },
  refresh_hash: { type: String, required: true, unique: true, index: true },
  expires_at: { type: Number, required: true },
  created_at: { type: Number, default: now },
}, { _id: false, versionKey: false });

export const User = mongoose.model('User', UserSchema);
export const Listener = mongoose.model('Listener', ListenerSchema);
export const Call = mongoose.model('Call', CallSchema);
export const CallMessage = mongoose.model('CallMessage', CallMessageSchema);
export const WalletTx = mongoose.model('WalletTx', WalletTxSchema);
export const Order = mongoose.model('Order', OrderSchema);
export const Payout = mongoose.model('Payout', PayoutSchema);
export const Report = mongoose.model('Report', ReportSchema);
export const Block = mongoose.model('Block', BlockSchema);
export const Favorite = mongoose.model('Favorite', FavoriteSchema);
export const Otp = mongoose.model('Otp', OtpSchema);
export const Session = mongoose.model('Session', SessionSchema);

// ------------------------------------------------------------- DB Connection

export async function connectDb() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  mongoose.set('strictQuery', false);
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  console.log(`[MongoDB] Connected to database: ${mongoose.connection.name}`);
  return mongoose.connection;
}

// ------------------------------------------------------------- Atomic Wallet Helpers

export async function creditCoins(userId, coins, kind, ref = null, amountPaise = 0) {
  await User.updateOne({ _id: userId }, { $inc: { coins } });
  await WalletTx.create({
    _id: uid('tx_'),
    user_id: userId,
    kind,
    coins,
    amount_paise: amountPaise,
    ref,
    created_at: now(),
  });
}

export async function debitCoins(userId, coins, kind, ref = null) {
  const res = await User.updateOne(
    { _id: userId, coins: { $gte: coins } },
    { $inc: { coins: -coins } }
  );
  if (res.modifiedCount === 0) throw new Error('Insufficient coins');
  await WalletTx.create({
    _id: uid('tx_'),
    user_id: userId,
    kind,
    coins: -coins,
    amount_paise: 0,
    ref,
    created_at: now(),
  });
}
