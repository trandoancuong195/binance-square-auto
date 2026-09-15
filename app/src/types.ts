import type { Timeframe } from './config/constants.js';
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; closeTime: number }
export interface Ticker { symbol: string; price: number; change24h: number; quoteVolume: number; trades: number }
export interface FrameAnalysis {
  candles: Candle[]; price: number; change: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  technical: { ema20: number; ema50: number; ema200: number; rsi: number; macd: number; macdSignal: number; macdHistogram: number; atr: number };
  volume: { average: number; ratio: number };
  levels: { support: number[]; resistance: number[] };
  breakout: boolean; supportBroken: boolean;
}
export interface Derivatives { funding: number | null; openInterest: number | null; oiChange1h: number | null; longShortRatio: number | null; unavailable: string[] }
export interface Analysis {
  symbol: string; asOf: string; price: number; change24h: number; quoteVolume: number;
  frames: Record<Timeframe, FrameAnalysis>; derivatives: Derivatives;
  trendScore: number; scoreComponents: Record<string, number | null>; scoreCoverage: number;
  warnings: string[];
}
export interface Snapshot { id: string; analysis: Analysis }
export interface Series {
  id: string; symbol: string; title: string; status: string; stage: string; thesis: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  bull_trigger: number | null; bear_trigger: number | null; invalidation_price: number | null;
  next_watch: string[]; version: number; last_updated_at: string;
}
export interface Post {
  id: string; symbol: string; series_id: string | null; snapshot_id: string; title: string;
  content: string; status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | 'FAILED';
  chart_paths: string[]; metadata: Record<string, unknown>; created_at: string;
  market_price: number;
}
export interface AgentContext { market: Omit<Analysis, 'frames'> & { frames: Record<Timeframe, Omit<FrameAnalysis, 'candles'>> }; recentPosts: Post[]; activeSeries: Series[]; previousThesis: string | null }
