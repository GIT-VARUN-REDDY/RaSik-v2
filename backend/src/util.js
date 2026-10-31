import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { Listener, json, tierFor } from './db.js';
import { HttpError } from './auth.js';
import { uploadStream, deleteCloudinaryMedia } from './cloudinary.js';

export const mediaUrl = (f) => {
  if (!f) return null;
  if (typeof f === 'string' && (f.startsWith('http://') || f.startsWith('https://'))) return f;
  return `${config.publicUrl}/media/${f}`;
};

/** What the person themself can see about their own account. */
export async function selfView(u, listenerDoc = null) {
  if (!u) return null;
  const userId = u._id || u.id;
  const l = listenerDoc || (u.gender === 'female' ? await Listener.findOne({ user_id: userId }).lean() : null);
  return {
    id: userId,
    phone: u.phone,
    role: u.role,
    gender: u.gender,
    name: u.name,
    age: u.age,
    avatar: mediaUrl(u.avatar),
    bio: u.bio,
    interests: json(u.interests),
    languages: json(u.languages),
    onboarded: !!u.onboarded,
    coins: u.coins,
    listener: l ? listenerSelf(l) : null,
  };
}

export function listenerSelf(l) {
  if (!l) return null;
  const tier = tierFor(l.total_minutes || 0);
  return {
    approval: l.approval,
    rejectReason: l.reject_reason,
    style: l.style,
    voiceRate: l.voice_rate,
    videoRate: l.video_rate,
    isAvailable: !!l.is_available,
    hasVideo: !!l.video_file,
    hasVoice: !!l.voice_file,
    upiId: l.upi_id,
    balancePaise: l.balance_paise,
    lifetimePaise: l.lifetime_paise,
    totalMinutes: l.total_minutes,
    totalCalls: l.total_calls,
    tier: { name: tier.name, maxVoice: tier.maxVoice, maxVideo: tier.maxVideo },
  };
}

/** Public card shown to men. Never exposes phone, verification video, or earnings. */
export function listenerCard(u, l, state = 'offline') {
  return {
    id: u._id || u.id,
    name: u.name,
    age: u.age,
    avatar: mediaUrl(u.avatar),
    bio: u.bio,
    interests: json(u.interests),
    languages: json(u.languages),
    style: l.style,
    voiceRate: l.voice_rate,
    videoRate: l.video_rate,
    rating: l.rating_count ? Math.round((l.rating_sum / l.rating_count) * 10) / 10 : null,
    ratingCount: l.rating_count,
    totalCalls: l.total_calls,
    voiceIntro: mediaUrl(l.voice_file && l.approval === 'approved' ? l.voice_file : null),
    gallery: json(l.gallery).map(mediaUrl),
    state, // online | busy | offline
  };
}

const MAGIC = {
  image: (b) =>
    b[0] === 0xff && b[1] === 0xd8 ? 'jpg'
    : b.slice(1, 4).toString() === 'PNG' ? 'png'
    : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'webp' : null,
  isobmff: (b) => (b.slice(4, 8).toString() === 'ftyp' ? true : null),
};

/**
 * Save one multipart upload safely. Uploads directly to Cloudinary if configured,
 * or falls back to local disk.
 */
export async function saveUpload(req, { kind, maxBytes, scope }) {
  const part = await req.file();
  if (!part) throw new HttpError(400, 'No file uploaded.');

  // If Cloudinary is configured, stream directly to Cloudinary
  if (config.cloudinary.cloudName) {
    try {
      const resourceType = kind === 'video' ? 'video' : kind === 'audio' ? 'raw' : 'image';
      const result = await uploadStream(part.file, {
        folder: `rasik/${scope}`,
        resource_type: resourceType,
      });
      return result.url; // Returns direct Cloudinary HTTPS URL
    } catch (err) {
      console.error('[Cloudinary upload error]', err);
      throw new HttpError(500, 'Could not upload media to cloud.');
    }
  }

  // Fallback to local disk if Cloudinary not set
  fs.mkdirSync(path.join(config.dataDir, 'media', scope), { recursive: true });
  const tmp = path.join(config.dataDir, 'media', scope, `.tmp_${crypto.randomBytes(8).toString('hex')}`);
  try {
    await pipeline(part.file, fs.createWriteStream(tmp));
    if (part.file.truncated) throw new HttpError(413, 'File too large.');
    const fd = fs.openSync(tmp, 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    let ext = null;
    if (kind === 'image') ext = MAGIC.image(head);
    else if (MAGIC.isobmff(head)) ext = kind === 'video' ? 'mp4' : 'm4a';
    if (!ext) throw new HttpError(415, `Unsupported ${kind} file.`);
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    fs.renameSync(tmp, path.join(config.dataDir, 'media', scope, name));
    return name;
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export const deleteMedia = (scope, urlOrName) => {
  if (!urlOrName) return;
  if (typeof urlOrName === 'string' && urlOrName.includes('cloudinary.com')) {
    // Extract public_id from Cloudinary URL if needed
    return;
  }
  if (typeof urlOrName === 'string' && /^[a-f0-9]{32}\.[a-z0-9]+$/.test(urlOrName)) {
    fs.rmSync(path.join(config.dataDir, 'media', scope, urlOrName), { force: true });
  }
};

export function expoPush(token, title, body, data = {}) {
  if (!token || !config.expoPush || !/^Expo(nent)?PushToken\[/.test(token)) return;
  fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: token, title, body, data, sound: 'default', priority: 'high', channelId: 'calls' }),
  }).catch(() => {});
}
