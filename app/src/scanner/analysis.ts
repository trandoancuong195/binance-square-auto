import { ticker, klines, derivatives } from '../binance/client.js';
import { analyzeFrame } from '../indicators/index.js';
import { trendScore } from './trend-score.js';
import { TIMEFRAMES, type Timeframe } from '../config/constants.js';
import type { Analysis, FrameAnalysis, Ticker } from '../types.js';
export async function analyze(symbol: string, existingTicker?: Ticker): Promise<Analysis> {
  const asOf = new Date().toISOString();
  const t = existingTicker ?? await ticker(symbol);
  const frames = {} as Record<Timeframe, FrameAnalysis>;
  for (const timeframe of TIMEFRAMES) frames[timeframe] = analyzeFrame(await klines(symbol, timeframe));
  const d = await derivatives(symbol);
  return {
    symbol, asOf, price: t.price, change24h: t.change24h, quoteVolume: t.quoteVolume,
    frames, derivatives: d, ...trendScore({ frames, derivatives: d }, t),
    warnings: d.unavailable.length ? [`Unavailable futures data: ${d.unavailable.join(', ')}`] : [],
  };
}
