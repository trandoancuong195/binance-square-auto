import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from './db/client.js';
import { scan } from './scanner/index.js';
import { generatePost } from './agent.js';
import { getSnapshot } from './memory/repository.js';
type Run = { id: string; status: string; result: unknown };
export const runningTasks = new Set<Promise<void>>();
const failureCode = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message) ? error.message : 'GENERATION_FAILED';

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

export async function startPipeline(requestKey: string, singlePost = false): Promise<Run> {
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
    const task = execute(id, lock, singlePost);
    runningTasks.add(task);
    void task.then(() => runningTasks.delete(task), () => runningTasks.delete(task));
    return { id, status: 'RUNNING', result: {} };
  } catch (error) { try { if (locked) await lock.query("SELECT pg_advisory_unlock(hashtext('crypto-agent-pipeline'))"); } finally { lock.release(); } throw error; }
}
async function execute(id: string, lock: PoolClient, singlePost: boolean): Promise<void> {
  try {
    const scanned = await scan();
    const results: unknown[] = [];
    let generated = 0;
    // Scanner orders by descending Trend Score. Select before calling the writer.
    const selected = singlePost ? scanned.tokens.slice(0, 1) : scanned.tokens;
    const total = selected.length;
    await lock.query('UPDATE agent_runs SET result=$2 WHERE id=$1', [id, JSON.stringify({ scanId: scanned.scanId, total, processed: 0, results, scanErrors: scanned.errors, skipped: scanned.skipped })]);
    for (const token of selected) {
      try {
        // Large batches can outlive snapshot freshness. Refresh data for queued tokens when needed.
        const snapshot = await getSnapshot(token.symbol, token.snapshotId);
        const result = await generatePost(token.symbol, snapshot ? token.snapshotId : undefined);
        if (result.decision !== 'EXISTING_DRAFT') generated++;
        results.push({ symbol: token.symbol, decision: result.decision, postId: result.post.id });
      } catch (error) { results.push({ symbol: token.symbol, error: failureCode(error) }); }
      await lock.query('UPDATE agent_runs SET result=$2 WHERE id=$1', [id, JSON.stringify({ scanId: scanned.scanId, total, processed: results.length, results, scanErrors: scanned.errors, skipped: scanned.skipped })]);
    }
    const hasErrors = scanned.errors.length > 0 || results.some(r => typeof r === 'object' && r !== null && 'error' in r);
    await lock.query('UPDATE agent_runs SET status=$2,result=$3,finished_at=now() WHERE id=$1', [id, hasErrors ? 'FAILED' : 'SUCCEEDED', JSON.stringify({ scanId: scanned.scanId, total, processed: results.length, results, scanErrors: scanned.errors, skipped: scanned.skipped, generated })]);
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
