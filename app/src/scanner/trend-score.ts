import type { Analysis, Ticker } from '../types.js';
const clamp = (v: number) => Math.min(1, Math.max(0, v));
export function trendScore(market: Pick<Analysis, 'frames' | 'derivatives'>, ticker: Ticker): Pick<Analysis, 'trendScore' | 'scoreComponents' | 'scoreCoverage'> {
  const frame = market.frames['1h'], d = market.derivatives;
  const components: Record<string, { weight: number; value: number | null }> = {
    volumeSpike: { weight: 25, value: clamp((frame.volume.ratio - 1) / 3) },
    momentum: { weight: 20, value: clamp(Math.abs(ticker.change24h) / 15) },
    openInterest: { weight: 15, value: d.oiChange1h === null ? null : clamp(Math.abs(d.oiChange1h) / 15) },
    breakout: { weight: 15, value: frame.breakout || frame.supportBroken ? 1 : 0 },
    tradeActivity: { weight: 10, value: clamp(ticker.trades / 500000) },
    volatility: { weight: 10, value: clamp(frame.technical.atr / frame.price / 0.03) },
    funding: { weight: 5, value: d.funding === null ? null : clamp(Math.abs(d.funding) / 0.001) },
  };
  let points = 0, available = 0;
  const scoreComponents: Record<string, number | null> = {};
  for (const [name, c] of Object.entries(components)) {
    scoreComponents[name] = c.value === null ? null : Math.round(c.value * c.weight * 100) / 100;
    if (c.value !== null) { available += c.weight; points += c.value * c.weight; }
  }
  // Missing futures components contribute no points; do not inflate sparse-data scores.
  return { trendScore: Math.round(points * 100) / 100, scoreComponents, scoreCoverage: available / 100 };
}
