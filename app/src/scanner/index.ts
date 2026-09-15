import { randomUUID } from 'node:crypto';
import { tickers } from '../binance/client.js';
import { env } from '../config/env.js';
import { pool } from '../db/client.js';
import { saveSnapshot } from '../memory/repository.js';
import { analyze } from './analysis.js';
import type { Analysis } from '../types.js';

export async function scan() {
  const scanId = randomUUID();
  const all = await tickers();
  const active = (await pool.query<{ symbol: string }>("SELECT symbol FROM series WHERE status='ACTIVE' ORDER BY last_updated_at ASC LIMIT 50")).rows.map(s => s.symbol);
  const preliminary = (t: typeof all[number]) => Math.abs(t.change24h) * Math.log10(Math.max(t.quoteVolume, 10));
  const shortlist = all.filter(t => t.quoteVolume >= env.MIN_QUOTE_VOLUME).sort((a, b) => preliminary(b) - preliminary(a)).slice(0, env.SCANNER_SHORTLIST);
  const symbols = new Set([...shortlist.map(t => t.symbol), ...active]);
  const analyses: Analysis[] = [], errors: { symbol: string; code: string }[] = [], skipped: { symbol: string; code: string }[] = [];
  for (const symbol of symbols) {
    const t = all.find(item => item.symbol === symbol);
    if (!t) { errors.push({ symbol, code: 'MARKET_UNAVAILABLE' }); continue; }
    try { analyses.push(await analyze(symbol, t)); }
    catch (error) {
      const code = error instanceof Error ? error.message : 'ANALYSIS_FAILED';
      if (code === 'INSUFFICIENT_CANDLES') { skipped.push({ symbol, code }); continue; }
      errors.push({ symbol, code: /^[A-Z][A-Z0-9_]{2,79}$/.test(code) ? code : 'ANALYSIS_FAILED' });
      if (code === 'BINANCE_BACKOFF') break;
    }
  }
  const tokens: { symbol: string; trendScore: number; snapshotId: string; tracked: boolean }[] = [];
  const selected = analyses.filter(a => a.trendScore >= env.MIN_TREND_SCORE).sort((a, b) => b.trendScore - a.trendScore);
  // Every trending candidate in the analyzed universe is passed to the writer.
  for (const analysis of selected) { const snapshot = await saveSnapshot(analysis); tokens.push({ symbol: analysis.symbol, trendScore: analysis.trendScore, snapshotId: snapshot.id, tracked: active.includes(analysis.symbol) }); }
  console.log(JSON.stringify({ event: 'scan_complete', scan_id: scanId, candidates: tokens.length, errors: errors.length }));
  return { scanId, tokens, errors, skipped };
}
