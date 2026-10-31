import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { ZodError } from 'zod';
import { config } from './config.js';
import { HttpError, userFromToken } from './auth.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import discoverRoutes from './routes/discover.js';
import walletRoutes from './routes/wallet.js';
import socialRoutes from './routes/social.js';
import adminRoutes from './routes/admin.js';

export async function buildApp() {
  const app = Fastify({
    logger: config.isProd ? { level: 'info', redact: ['req.headers.authorization'] } : { level: 'warn' },
    trustProxy: true,
    bodyLimit: 50 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(cors, { origin: config.corsOrigins === '*' ? true : config.corsOrigins.split(',') });
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 40 * 1024 * 1024, files: 1 } });

  // Keep the raw body for webhook signature checks.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body;
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body)); } catch { done(new HttpError(400, 'Invalid JSON')); }
  });

  app.decorate('auth', async (req) => {
    const h = req.headers.authorization || '';
    const u = h.startsWith('Bearer ') ? await userFromToken(h.slice(7)) : null;
    if (!u) throw new HttpError(401, 'Please sign in again.', 'unauthorized');
    req.user = u;
  });

  app.setErrorHandler((e, req, reply) => {
    if (e instanceof ZodError) return reply.code(400).send({ error: e.issues[0]?.message || 'Invalid request', code: 'validation' });
    if (e instanceof HttpError) return reply.code(e.status).send({ error: e.message, code: e.code });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    req.log.error(e);
    return reply.code(500).send({ error: 'Something went wrong. Please try again.' });
  });

  app.get('/health', async () => ({ ok: true, t: Date.now() }));

  // Public media only (avatars, voice intros). Verification videos live in a separate private folder.
  await app.register(fastifyStatic, {
    root: path.join(config.dataDir, 'media', 'public'), prefix: '/media/',
    cacheControl: true, maxAge: '7d', immutable: true, decorateReply: false,
  });
  await app.register(fastifyStatic, { root: path.join(config.root, 'public'), prefix: '/admin/', decorateReply: false });

  for (const r of [authRoutes, meRoutes, discoverRoutes, walletRoutes, socialRoutes, adminRoutes]) await app.register(r);
  return app;
}
