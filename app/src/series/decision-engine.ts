import type { AgentContext, Series } from '../types.js';
import type { Decision } from '../ai/types.js';

export type WritingDecision = Omit<Decision, 'decision'> & { decision: 'NEW_POST' | 'CONTINUE_SERIES' | 'UPDATE_SERIES' };

export function invalidated(series: Series, price: number): boolean {
  if (series.invalidation_price === null) return false;
  return series.bias === 'bullish' ? price <= series.invalidation_price : series.bias === 'bearish' ? price >= series.invalidation_price : false;
}
export function majorChange(context: AgentContext): boolean {
  const { market, recentPosts, activeSeries } = context, frame = market.frames['1h'];
  const previous = recentPosts[0];
  const state = previous?.metadata.marketState as { breakout?: boolean; supportBroken?: boolean; fundingExtreme?: boolean; oiExtreme?: boolean; framePrice?: number } | undefined;
  const previousPrice = state?.framePrice ?? previous?.market_price;
  const previousOutput = previous?.metadata.output as { series?: { stage?: string } } | undefined;
  return (previous !== undefined && Math.abs(market.price / previous.market_price - 1) > 0.03)
    || (Math.abs(market.derivatives.oiChange1h ?? 0) > 10 && !state?.oiExtreme)
    || (frame.breakout && !state?.breakout) || (frame.supportBroken && !state?.supportBroken)
    || (Math.abs(market.derivatives.funding ?? 0) >= 0.001 && !state?.fundingExtreme)
    || activeSeries.some(s => (invalidated(s, frame.price) && previousOutput?.series?.stage !== 'INVALIDATED') || (s.bull_trigger !== null && frame.price >= s.bull_trigger && (previousPrice === undefined || previousPrice < s.bull_trigger)) || (s.bear_trigger !== null && frame.price <= s.bear_trigger && (previousPrice === undefined || previousPrice > s.bear_trigger)));
}
export function planPost(context: AgentContext): WritingDecision {
  const importance = Math.max(0, Math.min(1, context.market.trendScore / 100));
  const broken = context.activeSeries.find(s => invalidated(s, context.market.frames['1h'].price));
  if (broken) return { decision: 'UPDATE_SERIES', seriesId: broken.id, reason: 'Nến một giờ đã đóng vượt mức vô hiệu của nhận định đang theo dõi.', importance: 1 };
  const series = context.activeSeries[0];
  if (!series) return { decision: 'NEW_POST', seriesId: null, reason: 'Tạo bài cho token được yêu cầu; chưa có series đang theo dõi.', importance };
  return {
    decision: majorChange(context) ? 'UPDATE_SERIES' : 'CONTINUE_SERIES',
    seriesId: series.id,
    reason: 'Viết bài từ dữ liệu hiện tại, nối tiếp series đang theo dõi.',
    importance,
  };
}
// Retain the existing /agent/decide endpoint contract without an AI call or SKIP gate.
export const decide = planPost;
