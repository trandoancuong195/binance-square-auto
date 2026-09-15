import type { Candle, FrameAnalysis } from '../types.js';

export function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period) return result;
  let previous = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = previous;
  for (let i = period; i < values.length; i++) { previous += (values[i]! - previous) * 2 / (period + 1); result[i] = previous; }
  return result;
}
function rsi(values: number[], period = 14): number {
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const delta = values[i]! - values[i - 1]!; gain += Math.max(delta, 0) / period; loss += Math.max(-delta, 0) / period; }
  for (let i = period + 1; i < values.length; i++) { const delta = values[i]! - values[i - 1]!; gain = (gain * (period - 1) + Math.max(delta, 0)) / period; loss = (loss * (period - 1) + Math.max(-delta, 0)) / period; }
  return loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
}
function atr(candles: Candle[], period = 14): number {
  const ranges = candles.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - candles[i]!.close), Math.abs(c.low - candles[i]!.close)));
  let value = ranges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const range of ranges.slice(period)) value = (value * (period - 1) + range) / period;
  return value;
}
function levels(candles: Candle[], price: number): FrameAnalysis['levels'] {
  const highs: number[] = [], lows: number[] = [];
  const history = candles.slice(-100, -1);
  for (let i = 2; i < history.length - 2; i++) {
    const c = history[i]!, neighbors = [history[i - 2]!, history[i - 1]!, history[i + 1]!, history[i + 2]!];
    if (neighbors.every(n => c.high > n.high)) highs.push(c.high);
    if (neighbors.every(n => c.low < n.low)) lows.push(c.low);
  }
  const unique = (values: number[]) => values.filter((v, i, all) => all.slice(0, i).every(other => Math.abs(v / other - 1) > 0.002)).slice(0, 3);
  return { support: unique([...lows, ...highs].filter(v => v < price).sort((a, b) => b - a)), resistance: unique([...highs, ...lows].filter(v => v > price).sort((a, b) => a - b)) };
}
export function analyzeFrame(candles: Candle[]): FrameAnalysis {
  if (candles.length < 250) throw new Error('INSUFFICIENT_CANDLES');
  const closes = candles.map(c => c.close), last = candles.at(-1)!, previous = candles.at(-2)!;
  const ema20 = ema(closes, 20).at(-1)!, ema50 = ema(closes, 50).at(-1)!, ema200 = ema(closes, 200).at(-1)!;
  if (ema20 === null || ema50 === null || ema200 === null) throw new Error('INSUFFICIENT_EMA');
  const fast = ema(closes, 12), slow = ema(closes, 26);
  const macds = closes.flatMap((_, i) => fast[i] != null && slow[i] != null ? [fast[i]! - slow[i]!] : []);
  const macd = macds.at(-1)!, macdSignal = ema(macds, 9).at(-1)!;
  if (macdSignal === null) throw new Error('INSUFFICIENT_MACD');
  const average = candles.slice(-21, -1).reduce((sum, c) => sum + c.volume, 0) / 20;
  const ratio = average > 0 ? last.volume / average : 0;
  const recent = candles.slice(-21, -1);
  return {
    candles, price: last.close, change: (last.close / previous.close - 1) * 100,
    trend: last.close > ema20 && ema20 > ema50 && ema50 > ema200 ? 'bullish' : last.close < ema20 && ema20 < ema50 && ema50 < ema200 ? 'bearish' : 'neutral',
    technical: { ema20, ema50, ema200, rsi: rsi(closes), atr: atr(candles), macd, macdSignal, macdHistogram: macd - macdSignal },
    volume: { average, ratio }, levels: levels(candles, last.close),
    breakout: last.close > Math.max(...recent.map(c => c.high)) && ratio >= 1.2,
    supportBroken: last.close < Math.min(...recent.map(c => c.low)) && ratio >= 1.2,
  };
}
