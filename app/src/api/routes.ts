import { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual, createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { env, outputRoot } from '../config/env.js';
import { SYMBOL_PATTERN } from '../config/constants.js';
import { pool } from '../db/client.js';
import { scan } from '../scanner/index.js';
import { analyze } from '../scanner/analysis.js';
import { activeSeries, getSnapshot, latestThesis, recentPosts, saveSnapshot } from '../memory/repository.js';
import { buildContext } from '../memory/context-builder.js';
import { decide } from '../series/decision-engine.js';
import { renderCharts } from '../chart/render.js';
import { deletePostCharts } from '../chart/cleanup.js';
import { generatePost } from '../agent.js';
import { approvePost } from '../series/repository.js';
import { startPipeline } from '../pipeline.js';
import { trendingPosts } from './trending.js';
import type { Post } from '../types.js';

export const api = Router();
const hash = (value: string) => createHash('sha256').update(value).digest();
api.use((req, res, next) => {
  if (!timingSafeEqual(hash(req.get('X-API-Key') ?? ''), hash(env.INTERNAL_API_KEY))) { res.status(401).json({ error: 'UNAUTHORIZED' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  next();
});
type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
let heavyRequests = 0;
const heavy = (handler: Handler): Handler => async (req, res) => {
  if (heavyRequests >= 2) { res.status(429).json({ error: 'SERVICE_BUSY' }); return; }
  heavyRequests++;
  try { return await handler(req, res); } finally { heavyRequests--; }
};
const symbol = (req: Request) => z.string().regex(SYMBOL_PATTERN).parse(req.params.symbol?.toUpperCase());
const idSchema = z.string().regex(/^[1-9]\d{0,17}$/);
const id = (req: Request) => idSchema.parse(req.params.id);
const generationBody = z.object({ snapshotId: idSchema.optional() }).strict();

api.get('/ready', wrap(async (_req, res) => {
  await pool.query('SELECT id FROM market_snapshots LIMIT 0');
  res.json({ status: 'ok', database: 'ready', aiConfigured: Boolean(env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL), aiWriterEnabled: env.AI_WRITER_ENABLED, publishEnabled: false });
}));
api.post('/scanner/run', wrap(heavy(async (_req, res) => { res.json(await scan()); })));
api.post('/analyze/:symbol', wrap(heavy(async (req, res) => { res.json(await saveSnapshot(await analyze(symbol(req)))); })));
api.get('/memory/:symbol', wrap(async (req, res) => {
  const name = symbol(req);
  const [posts, series, thesis] = await Promise.all([recentPosts(name), activeSeries(name), latestThesis(name)]);
  res.json({ symbol: name, recentPosts: posts, activeSeries: series, previousThesis: thesis });
}));
api.post('/agent/decide/:symbol', wrap(heavy(async (req, res) => {
  const body = generationBody.parse(req.body ?? {}), name = symbol(req);
  const snapshot = await getSnapshot(name, body.snapshotId);
  if (!snapshot) throw new Error('SNAPSHOT_EXPIRED_OR_NOT_FOUND');
  res.json(await decide(await buildContext(snapshot.analysis)));
})));
api.post('/chart/:symbol', wrap(heavy(async (req, res) => {
  const body = generationBody.parse(req.body ?? {});
  const snapshot = await getSnapshot(symbol(req), body.snapshotId);
  if (!snapshot) throw new Error('SNAPSHOT_EXPIRED_OR_NOT_FOUND');
  res.json({ snapshotId: snapshot.id, chartPaths: await renderCharts(snapshot) });
})));
api.post('/post/generate/:symbol', wrap(heavy(async (req, res) => {
  const body = generationBody.parse(req.body ?? {});
  res.json(await generatePost(symbol(req), body.snapshotId));
})));
api.post('/posts/trending', wrap(async (req, res) => {
  const body = z.object({ requestKey: z.string().min(8).max(160) }).strict().parse(req.body);
  const result = await trendingPosts(body.requestKey);
  if (!result.done) res.setHeader('Retry-After', '30');
  res.status(result.done ? 200 : 202).json(result);
}));
api.get('/posts', wrap(async (req, res) => {
  const query = z.object({ status: z.enum(['DRAFT', 'APPROVED', 'PUBLISHED', 'FAILED']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30), before: idSchema.optional() }).parse(req.query);
  const result = await pool.query<Post>('SELECT * FROM posts WHERE ($1::text IS NULL OR status=$1) AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT $3', [query.status ?? null, query.before ?? null, query.limit]);
  res.json({ posts: result.rows, nextCursor: result.rows.length === query.limit ? result.rows.at(-1)!.id : null });
}));
api.get('/posts/:id', wrap(async (req, res) => {
  const post = (await pool.query<Post>('SELECT * FROM posts WHERE id=$1', [id(req)])).rows[0];
  if (!post) throw new Error('POST_NOT_FOUND');
  res.json(post);
}));
api.delete('/posts/:id/charts', wrap(async (req, res) => {
  res.json(await deletePostCharts(id(req)));
}));
api.get('/posts/:id/charts/:index', wrap(async (req, res) => {
  const index = z.coerce.number().int().min(0).max(1).parse(req.params.index);
  const post = (await pool.query<Post>('SELECT * FROM posts WHERE id=$1', [id(req)])).rows[0];
  const relative = post?.chart_paths[index];
  if (!relative) throw new Error('CHART_NOT_FOUND');
  const file = path.resolve(outputRoot, relative);
  const fromRoot = path.relative(outputRoot, file);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) throw new Error('INVALID_CHART_PATH');
  await new Promise<void>((resolve, reject) => res.sendFile(file, error => error ? reject(new Error('CHART_NOT_FOUND')) : resolve()));
}));
api.post('/posts/:id/approve', wrap(async (req, res) => { res.json(await approvePost(id(req))); }));
api.post('/posts/:id/reject', wrap(async (req, res) => {
  const result = await pool.query<Post>("UPDATE posts SET status='FAILED',metadata=metadata || '{\"rejectedByReviewer\":true}'::jsonb WHERE id=$1 AND status='DRAFT' RETURNING *", [id(req)]);
  if (!result.rowCount) throw new Error('POST_NOT_DRAFT');
  res.json(result.rows[0]);
}));
api.post('/post/publish/:id', (_req, res) => { res.status(501).json({ error: 'PUBLISH_DISABLED', message: 'MVP chỉ lưu và duyệt draft. Chưa tích hợp Binance Square publishing.' }); });
api.post('/pipeline/run', wrap(async (req, res) => {
  const body = z.object({ requestKey: z.string().min(8).max(160) }).strict().parse(req.body);
  res.status(202).json(await startPipeline(body.requestKey));
}));
api.get('/pipeline/runs', wrap(async (_req, res) => {
  res.json({ runs: (await pool.query('SELECT id,status,result,created_at,finished_at FROM agent_runs ORDER BY created_at DESC LIMIT 20')).rows });
}));
api.get('/pipeline/runs/:id', wrap(async (req, res) => {
  const runId = z.string().uuid().parse(req.params.id);
  const run = (await pool.query('SELECT id,status,result,created_at,finished_at FROM agent_runs WHERE id=$1', [runId])).rows[0];
  if (!run) throw new Error('RUN_NOT_FOUND');
  res.json(run);
}));

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (error instanceof z.ZodError) { res.status(400).json({ error: 'INVALID_INPUT', fields: error.issues.map(i => i.path.join('.')) }); return; }
  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed') { res.status(400).json({ error: 'INVALID_JSON' }); return; }
  const candidate = error instanceof Error ? error.message : '';
  const code = /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate) ? candidate : 'INTERNAL_ERROR';
  const status = code.endsWith('_NOT_FOUND') ? 404 : code.endsWith('_BUSY') || code === 'SERIES_CHANGED_REGENERATE_DRAFT' || code === 'POST_NOT_DRAFT' || code === 'POST_CONTENT_PENDING' ? 409 : code === 'UNSUPPORTED_SYMBOL' ? 400 : code === 'POST_QUALITY_INVALID' ? 422 : code.startsWith('AI_') || code.startsWith('BINANCE_') ? 502 : 500;
  console.error(JSON.stringify({ event: 'request_error', code }));
  res.status(status).json({ error: code });
}
