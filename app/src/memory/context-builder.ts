import { activeSeries, latestThesis, recentPosts } from './repository.js';
import { TIMEFRAMES } from '../config/constants.js';
import { env } from '../config/env.js';
import type { AgentContext, Analysis } from '../types.js';
export async function buildContext(analysis: Analysis): Promise<AgentContext> {
  const frames = {} as AgentContext['market']['frames'];
  for (const tf of TIMEFRAMES) { const { candles: _, ...summary } = analysis.frames[tf]; frames[tf] = summary; }
  if (!env.DB_CONTEXT_ENABLED) {
    console.info(JSON.stringify({ event: 'db_context_bypassed', symbol: analysis.symbol }));
    return { market: { ...analysis, frames }, recentPosts: [], activeSeries: [], previousThesis: null };
  }
  const [posts, series, thesis] = await Promise.all([recentPosts(analysis.symbol), activeSeries(analysis.symbol), latestThesis(analysis.symbol)]);
  return { market: { ...analysis, frames }, recentPosts: posts, activeSeries: series, previousThesis: thesis };
}
