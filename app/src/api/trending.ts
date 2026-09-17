import { z } from 'zod';
import { env } from '../config/env.js';
import { startPipeline } from '../pipeline.js';
import { loadTrendingPost } from '../trending-post.js';

const entries = z.array(z.object({ postId: z.string().regex(/^[1-9]\d{0,17}$/).optional() }).passthrough());
const selectionSchema = z.object({
  strategy: z.string(), cooldownHours: z.number(), maxAttempts: z.number(),
  recentSymbols: z.array(z.string()), candidateSymbols: z.array(z.string()),
}).passthrough();
const resultSchema = z.object({ results: entries.optional(), selection: selectionSchema.optional() }).passthrough();

export async function trendingPosts(requestKey: string) {
  if (!env.AI_WRITER_ENABLED) throw new Error('AI_WRITER_DISABLED');
  // Retries/polls reuse the existing run, including after HTTP disconnects or restarts.
  const run = await startPipeline(`trending:${requestKey}`, 'trending');
  const parsed = resultSchema.safeParse(run.result);
  const selection = parsed.success ? parsed.data.selection ?? null : null;
  if (run.status === 'RUNNING') return {
    runId: run.id, status: run.status, done: false, hasPosts: false,
    retryAfterSeconds: 30, post: null, posts: [], selection, result: run.result,
  };
  // Pin to the first post even for runs created before the single-post limit.
  // Do not switch to another post on a retry after the first post's charts were deleted.
  const ids = parsed.success ? [...new Set((parsed.data.results ?? []).flatMap(entry => entry.postId ? [entry.postId] : []))].slice(0, 1) : [];
  const selectedPost = ids[0] ? await loadTrendingPost(ids[0]) : null;
  const posts = selectedPost ? [selectedPost] : [];
  const payload = posts.map(post => ({
    id: post.id, symbol: post.symbol, title: post.title, content: post.content,
    chart_paths: post.chart_paths, status: post.status,
    imageCount: post.chart_paths.length,
    chartPlan: post.metadata.chartPlan ?? null,
    dedupeKey: `crypto-square-post-${post.id}`,
  }));
  return {
    runId: run.id, status: run.status, done: true, hasPosts: posts.length > 0,
    retryAfterSeconds: null,
    post: payload[0] ?? null,
    posts: payload,
    selection,
    // FAILED can contain successful posts; preserve per-token errors for the caller.
    result: run.result,
  };
}
