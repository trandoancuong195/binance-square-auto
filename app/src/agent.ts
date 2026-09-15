import { pool, transaction } from './db/client.js';
import { env } from './config/env.js';
import { getSnapshot, saveSnapshot } from './memory/repository.js';
import { buildContext } from './memory/context-builder.js';
import { analyze } from './scanner/analysis.js';
import { planPost } from './series/decision-engine.js';
import { fixedFacts, writeDraft } from './ai/writer.js';
import type { DraftOutput } from './ai/types.js';
import { qualityGate } from './ai/quality.js';
import { renderCharts } from './chart/render.js';
import type { Post } from './types.js';

type GenerateResult = { decision: 'EXISTING_DRAFT' | 'NEW_POST' | 'CONTINUE_SERIES' | 'UPDATE_SERIES'; post: Post };
export async function generatePost(symbol: string, snapshotId?: string): Promise<GenerateResult> {
  const lock = await pool.connect();
  let locked = false;
  let stage = 'load_snapshot';
  let usedSnapshotId = snapshotId ?? null;
  try {
    locked = (await lock.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`generate:${symbol}`])).rows[0]!.locked;
    if (!locked) throw new Error('SYMBOL_BUSY');
    if (snapshotId) {
      const existing = (await pool.query<Post>('SELECT * FROM posts WHERE symbol=$1 AND snapshot_id=$2', [symbol, snapshotId])).rows[0];
      if (existing) return { decision: 'EXISTING_DRAFT', post: existing };
    }
    let snapshot = await getSnapshot(symbol, snapshotId);
    if (!snapshot && snapshotId) throw new Error('SNAPSHOT_EXPIRED_OR_NOT_FOUND');
    snapshot ??= await saveSnapshot(await analyze(symbol));
    usedSnapshotId = snapshot.id;
    const existing = (await pool.query<Post>('SELECT * FROM posts WHERE snapshot_id=$1', [snapshot.id])).rows[0];
    if (existing) return { decision: 'EXISTING_DRAFT', post: existing };
    stage = 'load_context';
    const context = await buildContext(snapshot.analysis);
    const decision = planPost(context);
    let output: DraftOutput | null = null;
    let quality: ReturnType<typeof qualityGate> | null = null;
    let title = `${symbol} — Bản nháp dữ liệu`;
    let content = `${title}\n\nChưa có nội dung phân tích bằng AI.\n\n${fixedFacts(context)}`;
    const writerMode = env.AI_WRITER_ENABLED ? 'ai' : 'data_only';
    const aiModel = env.AI_WRITER_ENABLED ? env.AI_MODEL : null;
    if (env.AI_WRITER_ENABLED) {
      stage = 'ai_writer';
      const draft = await writeDraft(context, decision);
      output = draft.output;
      content = draft.content;
      title = output.post.title;
      stage = 'quality_gate';
      quality = qualityGate(content, output, context);
      if (!quality.passed) {
        console.warn(JSON.stringify({ event: 'post_quality_failed', symbol, snapshot_id: snapshot.id, reasons: quality.reasons }));
        throw new Error('POST_QUALITY_INVALID');
      }
    } else {
      console.log(JSON.stringify({ event: 'ai_writer_bypassed', symbol, snapshot_id: snapshot.id }));
    }
    stage = 'render_chart';
    const chartPaths = await renderCharts(snapshot);
    if (quality) { quality.components.chartQuality = 5; quality.score += 5; }
    const seriesVersion = context.activeSeries.find(s => s.id === decision.seriesId)?.version ?? null;
    const frame = snapshot.analysis.frames['1h'];
    const marketState = { framePrice: frame.price, breakout: frame.breakout, supportBroken: frame.supportBroken, fundingExtreme: Math.abs(snapshot.analysis.derivatives.funding ?? 0) >= 0.001, oiExtreme: Math.abs(snapshot.analysis.derivatives.oiChange1h ?? 0) > 10 };
    stage = 'save_draft';
    const post = await transaction(async client => {
      const result = await client.query<Post>(`INSERT INTO posts(symbol,series_id,snapshot_id,post_type,title,content,market_price,trend_score,chart_paths,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [symbol, decision.seriesId, snapshot!.id, decision.decision, title, content, snapshot!.analysis.price, snapshot!.analysis.trendScore, JSON.stringify(chartPaths), JSON.stringify({ decision, output, quality, seriesVersion, marketState, writerMode, aiModel, scanAsOf: snapshot!.analysis.asOf })]);
      return result.rows[0]!;
    });
    console.log(JSON.stringify({ event: 'draft_created', symbol, post_id: post.id, series_id: post.series_id, decision: decision.decision, trend_score: snapshot.analysis.trendScore, writer_mode: writerMode, ai_model: aiModel }));
    return { decision: decision.decision, post };
  } catch (error) {
    const nativeCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(error.code) ? error.code : null;
    const knownCode = error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message) ? error.message : null;
    const code = knownCode ?? (stage === 'save_draft' ? `DRAFT_SAVE_FAILED${nativeCode ? `_${nativeCode}` : ''}` : 'DRAFT_GENERATION_FAILED');
    // Database error details may contain post content. Log only stage and machine-readable codes.
    console.error(JSON.stringify({ event: 'draft_generation_failed', symbol, snapshot_id: usedSnapshotId, stage, code, native_code: nativeCode }));
    throw new Error(code);
  } finally {
    try { if (locked) await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [`generate:${symbol}`]); }
    finally { lock.release(); }
  }
}
