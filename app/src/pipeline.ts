import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from './config/env.js';
import { pool } from './db/client.js';
import { scan } from './scanner/index.js';
import { generatePost } from './agent.js';
import { getSnapshot } from './memory/repository.js';
import { loadTrendingPost } from './trending-post.js';
type Run = { id: string; status: string; result: unknown };
type PipelineMode = 'all' | 'trending';
type ScanToken = Awaited<ReturnType<typeof scan>>['tokens'][number];
type TrendingHistoryRow = { result: unknown; created_at: string };
type TrendingSelection = {
  strategy: 'HIGHEST_SCORE_OUTSIDE_COOLDOWN' | 'LEAST_RECENTLY_SELECTED' | 'ONLY_AVAILABLE_TOKEN' | 'NO_CANDIDATE';
  cooldownHours: number;
  maxAttempts: number;
  recentSymbols: string[];
  candidateSymbols: string[];
};
export const runningTasks = new Set<Promise<void>>();
const failureCode = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message) ? error.message : 'GENERATION_FAILED';

const successfulSymbol = (result: unknown): string | null => {
  if (typeof result !== 'object' || result === null || !('results' in result) || !Array.isArray(result.results)) return null;
  for (const entry of result.results) {
    if (typeof entry === 'object' && entry !== null && 'symbol' in entry && typeof entry.symbol === 'string' && 'postId' in entry && typeof entry.postId === 'string') return entry.symbol;
  }
  return null;
};

async function rankTrendingCandidates(id: string, client: PoolClient, tokens: ScanToken[]): Promise<{ tokens: ScanToken[]; selection: TrendingSelection }> {
  if (!tokens.length) return {
    tokens: [],
    selection: { strategy: 'NO_CANDIDATE', cooldownHours: env.TRENDING_SYMBOL_COOLDOWN_HOURS, maxAttempts: env.TRENDING_MAX_CANDIDATE_ATTEMPTS, recentSymbols: [], candidateSymbols: [] },
  };
  const rows = (await client.query<TrendingHistoryRow>(
    `SELECT result,created_at FROM agent_runs
      WHERE request_key LIKE 'trending:%' AND id<>$1 AND status IN ('SUCCEEDED','FAILED')
      ORDER BY created_at DESC LIMIT 100`, [id],
  )).rows;
  const candidateSymbols = new Set(tokens.map(token => token.symbol));
  const history = rows.flatMap(row => {
    const symbol = successfulSymbol(row.result);
    return symbol && candidateSymbols.has(symbol) ? [{ symbol, selectedAt: new Date(row.created_at).getTime() }] : [];
  });
  const recentSymbols = [...new Set(history.map(item => item.symbol))].slice(0, 10);
  const lastSelectedAt = new Map<string, number>();
  for (const item of history) if (!lastSelectedAt.has(item.symbol)) lastSelectedAt.set(item.symbol, item.selectedAt);
  const cutoff = Date.now() - env.TRENDING_SYMBOL_COOLDOWN_HOURS * 60 * 60 * 1000;
  const outsideCooldown = tokens.filter(token => (lastSelectedAt.get(token.symbol) ?? 0) <= cutoff);
  let ranked: ScanToken[];
  let strategy: TrendingSelection['strategy'];
  if (outsideCooldown.length) {
    const allowed = new Set(outsideCooldown.map(token => token.symbol));
    ranked = [...outsideCooldown, ...tokens.filter(token => !allowed.has(token.symbol))];
    strategy = 'HIGHEST_SCORE_OUTSIDE_COOLDOWN';
  } else if (tokens.length === 1) {
    ranked = tokens;
    strategy = 'ONLY_AVAILABLE_TOKEN';
  } else {
    const mostRecentSymbol = history[0]?.symbol;
    ranked = tokens
      .map((token, scannerRank) => ({ token, scannerRank, selectedAt: lastSelectedAt.get(token.symbol) ?? 0 }))
      .sort((left, right) => {
        if (left.token.symbol === mostRecentSymbol && right.token.symbol !== mostRecentSymbol) return 1;
        if (right.token.symbol === mostRecentSymbol && left.token.symbol !== mostRecentSymbol) return -1;
        return left.selectedAt - right.selectedAt || left.scannerRank - right.scannerRank;
      })
      .map(item => item.token);
    strategy = 'LEAST_RECENTLY_SELECTED';
  }
  const limited = ranked.slice(0, env.TRENDING_MAX_CANDIDATE_ATTEMPTS);
  return {
    tokens: limited,
    selection: {
      strategy,
      cooldownHours: env.TRENDING_SYMBOL_COOLDOWN_HOURS,
      maxAttempts: env.TRENDING_MAX_CANDIDATE_ATTEMPTS,
      recentSymbols,
      candidateSymbols: limited.map(token => token.symbol),
    },
  };
}

export async function recoverInterruptedRuns(): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext('crypto-agent-pipeline')) AS locked")).rows[0]!.locked;
    if (locked) await client.query("UPDATE agent_runs SET status='FAILED',result=result || $1::jsonb,finished_at=now() WHERE status='RUNNING'", [JSON.stringify({ code: 'PROCESS_INTERRUPTED' })]);
  } finally {
    try { if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('crypto-agent-pipeline'))"); }
    finally { client.release(); }
  }
}

export async function startPipeline(requestKey: string, mode: PipelineMode = 'all'): Promise<Run> {
  const existing = (await pool.query<Run>('SELECT id,status,result FROM agent_runs WHERE request_key=$1', [requestKey])).rows[0];
  if (existing) return existing;
  const lock = await pool.connect();
  let locked = false;
  try {
    locked = (await lock.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext('crypto-agent-pipeline')) AS locked")).rows[0]!.locked;
    if (!locked) throw new Error('PIPELINE_BUSY');
    // A retry may have arrived while the first request was inserting its run.
    const repeated = (await lock.query<Run>('SELECT id,status,result FROM agent_runs WHERE request_key=$1', [requestKey])).rows[0];
    if (repeated) { await lock.query("SELECT pg_advisory_unlock(hashtext('crypto-agent-pipeline'))"); lock.release(); return repeated; }
    const id = randomUUID();
    await lock.query("UPDATE agent_runs SET status='FAILED',result=$1,finished_at=now() WHERE status='RUNNING'", [JSON.stringify({ code: 'PROCESS_INTERRUPTED' })]);
    await lock.query("INSERT INTO agent_runs(id,request_key,status) VALUES($1,$2,'RUNNING')", [id, requestKey]);
    const task = execute(id, lock, mode);
    runningTasks.add(task);
    void task.then(() => runningTasks.delete(task), () => runningTasks.delete(task));
    return { id, status: 'RUNNING', result: {} };
  } catch (error) { try { if (locked) await lock.query("SELECT pg_advisory_unlock(hashtext('crypto-agent-pipeline'))"); } finally { lock.release(); } throw error; }
}
async function execute(id: string, lock: PoolClient, mode: PipelineMode): Promise<void> {
  try {
    const scanned = await scan();
    const results: unknown[] = [];
    let generated = 0;
    const trending = mode === 'trending' ? await rankTrendingCandidates(id, lock, scanned.tokens) : null;
    // The trending mode tries candidates in diversity order until one usable post exists.
    const selected = trending?.tokens ?? scanned.tokens;
    const targetTotal = mode === 'trending' ? Math.min(1, selected.length) : selected.length;
    const baseResult = { scanId: scanned.scanId, total: targetTotal, scanErrors: scanned.errors, skipped: scanned.skipped, ...(trending ? { selection: trending.selection } : {}) };
    await lock.query('UPDATE agent_runs SET result=$2 WHERE id=$1', [id, JSON.stringify({ ...baseResult, processed: 0, attempted: 0, results })]);
    let delivered = false;
    for (const token of selected) {
      try {
        // Large batches can outlive snapshot freshness. Refresh data for queued tokens when needed.
        const snapshot = await getSnapshot(token.symbol, token.snapshotId);
        const result = await generatePost(token.symbol, snapshot ? token.snapshotId : undefined);
        if (result.decision !== 'EXISTING_DRAFT') generated++;
        if (mode === 'trending' && !await loadTrendingPost(result.post.id)) {
          throw new Error('TRENDING_POST_NOT_READY');
        }
        results.push({ symbol: token.symbol, decision: result.decision, postId: result.post.id });
        delivered = true;
      } catch (error) { results.push({ symbol: token.symbol, error: failureCode(error) }); }
      await lock.query('UPDATE agent_runs SET result=$2 WHERE id=$1', [id, JSON.stringify({ ...baseResult, processed: mode === 'trending' ? Number(delivered) : results.length, attempted: results.length, results })]);
      if (mode === 'trending' && delivered) break;
    }
    const attemptFailed = results.some(r => typeof r === 'object' && r !== null && 'error' in r);
    const hasErrors = scanned.errors.length > 0 || (mode === 'trending' ? !delivered && attemptFailed : attemptFailed);
    const completedResult = { ...baseResult, processed: mode === 'trending' ? Number(delivered) : results.length, attempted: results.length, results, generated };
    await lock.query('UPDATE agent_runs SET status=$2,result=$3,finished_at=now() WHERE id=$1', [id, hasErrors ? 'FAILED' : 'SUCCEEDED', JSON.stringify(completedResult)]);
    console.log(JSON.stringify({ event: 'pipeline_complete', run_id: id, generated, hasErrors }));
  } catch {
    try { await lock.query("UPDATE agent_runs SET status='FAILED',result=$2,finished_at=now() WHERE id=$1", [id, JSON.stringify({ code: 'PIPELINE_FAILED' })]); }
    catch { console.error(JSON.stringify({ event: 'pipeline_persistence_failed', run_id: id })); }
  } finally {
    try { await lock.query("SELECT pg_advisory_unlock(hashtext('crypto-agent-pipeline'))"); }
    catch { /* Connection failure releases the session lock at PostgreSQL. */ }
    lock.release();
  }
}
