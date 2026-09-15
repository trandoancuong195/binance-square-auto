import express from 'express';
import path from 'node:path';
import { env, appRoot } from './config/env.js';
import { api, errorHandler } from './api/routes.js';
import { pool } from './db/client.js';
import { runningTasks, recoverInterruptedRuns } from './pipeline.js';
const app = express();
// Best effort: /health remains available before the initial database migration.
await recoverInterruptedRuns().catch(() => console.error(JSON.stringify({ event: 'database_recovery_unavailable', message: 'Check database connectivity and run migrations.' })));
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  next();
});
app.use(express.json({ limit: '16kb' }));
app.get('/health', (_req, res) => { res.json({ status: 'ok', service: 'crypto-square-agent' }); });
app.get('/', (_req, res) => { res.redirect('/review'); });
app.get('/review', (_req, res) => { res.sendFile(path.join(appRoot, 'public/index.html')); });
app.get('/review.js', (_req, res) => { res.sendFile(path.join(appRoot, 'public/review.js')); });
app.get('/review.css', (_req, res) => { res.sendFile(path.join(appRoot, 'public/review.css')); });
app.use(api);
app.use((_req, res) => { res.status(404).json({ error: 'NOT_FOUND' }); });
app.use(errorHandler);
const server = app.listen(env.PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: 'server_started', host: env.HOST, port: env.PORT, publish_enabled: false }));
});
server.requestTimeout = 300000;
server.on('error', () => { console.error('Server failed to listen; check host and port.'); process.exitCode = 1; });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 30000);
  deadline.unref();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await Promise.allSettled([...runningTasks]);
  await pool.end();
  clearTimeout(deadline);
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
