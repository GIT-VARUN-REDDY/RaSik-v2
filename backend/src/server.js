import { config } from './config.js';
import { connectDb } from './db.js';
import { buildApp } from './app.js';
import { attachRealtime } from './realtime.js';

await connectDb();
const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
const wss = await attachRealtime(app.server);
console.log(`RaSik API on :${config.port}  (env=${config.isProd ? 'production' : 'development'}, sms=${config.sms.provider}, payments=${config.mockPayments ? 'MOCK' : 'razorpay'})`);

const shutdown = async () => {
  wss.clients.forEach((c) => c.close(1001, 'server restarting'));
  app.server.closeIdleConnections();
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
