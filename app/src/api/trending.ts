import { z } from 'zod';
import { env } from '../config/env.js';
import { pool } from '../db/client.js';
import { startPipeline } from '../pipeline.js';
import type { Post } from '../types.js';

const entries = z.array(z.object({ postId: z.string().regex(/^[1-9]\d{0,17}$/).optional() }).passthrough());
const resultSchema = z.object({ results: entries.optional() }).passthrough();

export async function trendingPosts(requestKey: string) {
  if (!env.AI_WRITER_ENABLED) throw new Error('AI_WRITER_DISABLED');
  // Retries/polls reuse the existing run, including after HTTP disconnects or restarts.
  const run = await startPipeline(`trending:${requestKey}`, true);
  if (run.status === 'RUNNING') return {
    runId: run.id, status: run.status, done: false, hasPosts: false,
    retryAfterSeconds: 30, posts: [], result: run.result,
  };
  const parsed = resultSchema.safeParse(run.result);
  // Pin to the first post even for runs created before the single-post limit.
  // Do not switch to another post on a retry after the first post's charts were deleted.
  const ids = parsed.success ? [...new Set((parsed.data.results ?? []).flatMap(entry => entry.postId ? [entry.postId] : []))].slice(0, 1) : [];
  const posts = ids.length ? (await pool.query<Post>(
    `SELECT * FROM posts WHERE id = ANY($1::bigint[])
      AND status IN ('DRAFT','APPROVED') AND square_post_id IS NULL
      AND metadata->>'writerMode' = 'ai'
      AND metadata->'quality'->>'passed' = 'true'
      ORDER BY array_position($1::bigint[], id)`, [ids],
  )).rows.filter(post => post.content.trim().length > 0 && post.chart_paths.length > 0) : [];
  return {
    runId: run.id, status: run.status, done: true, hasPosts: posts.length > 0,
    retryAfterSeconds: null,
    posts: posts.map(post => ({
      id: post.id, symbol: post.symbol, title: post.title, content: post.content,
      chart_paths: post.chart_paths, status: post.status,
      dedupeKey: `crypto-square-post-${post.id}`,
    })),
    // FAILED can contain successful posts; preserve per-token errors for the caller.
    result: run.result,
  };
}
