import { pool } from '../db/client.js';
import type { Analysis, Post, Series, Snapshot } from '../types.js';
import { env } from '../config/env.js';
export async function saveSnapshot(analysis: Analysis): Promise<Snapshot> {
  const result = await pool.query<{ id: string }>('INSERT INTO market_snapshots(symbol,analysis) VALUES($1,$2) RETURNING id', [analysis.symbol, JSON.stringify(analysis)]);
  return { id: result.rows[0]!.id, analysis };
}
export async function getSnapshot(symbol: string, id?: string): Promise<Snapshot | null> {
  const result = await pool.query<{ id: string; analysis: Analysis }>(`SELECT id,analysis FROM market_snapshots WHERE symbol=$1 AND ($2::bigint IS NULL OR id=$2::bigint) ORDER BY created_at DESC LIMIT 1`, [symbol, id ?? null]);
  const row = result.rows[0];
  if (!row) return null;
  const age = Date.now() - new Date(row.analysis.asOf).getTime();
  if (!Number.isFinite(age) || age < -60000 || age > env.SNAPSHOT_MAX_AGE_MINUTES * 60000) return null;
  return row;
}
export async function recentPosts(symbol: string): Promise<Post[]> {
  return (await pool.query<Post>("SELECT * FROM posts WHERE symbol=$1 AND status <> 'FAILED' ORDER BY created_at DESC LIMIT 3", [symbol])).rows;
}
export async function activeSeries(symbol: string): Promise<Series[]> {
  return (await pool.query<Series>("SELECT * FROM series WHERE symbol=$1 AND status='ACTIVE' ORDER BY last_updated_at DESC LIMIT 3", [symbol])).rows;
}
export async function latestThesis(symbol: string): Promise<string | null> {
  const result = await pool.query<{ content: string }>("SELECT content FROM agent_memory WHERE symbol=$1 AND memory_type='THESIS' AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1", [symbol]);
  return result.rows[0]?.content ?? null;
}
