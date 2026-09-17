import type { AgentContext } from '../types.js';

export type EditorialStyle = 'price' | 'volume' | 'oi' | 'positioning';
export type DashboardTemplate = 'market' | 'derivatives' | 'timeframes';
export type TechnicalTimeframe = '1h' | '4h';
export type ChartPlan = { technicalTimeframes: TechnicalTimeframe[]; dashboard: DashboardTemplate; imageCount: number };
export type PostPresentation = { style: EditorialStyle; layout: number; chartPlan: ChartPlan };

const hash = (value: string) => Array.from(value).reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 0);
const previousDashboard = (context: AgentContext): DashboardTemplate | null => {
  const plan = context.recentPosts[0]?.metadata.chartPlan;
  if (typeof plan !== 'object' || plan === null || !('dashboard' in plan)) return null;
  return plan.dashboard === 'market' || plan.dashboard === 'derivatives' || plan.dashboard === 'timeframes' ? plan.dashboard : null;
};

export function presentation(context: AgentContext) {
  const m = context.market, d = m.derivatives, f = m.frames['1h'];
  const eligible: EditorialStyle[] = ['price'];
  if (f.volume.ratio >= 1.2) eligible.push('volume');
  if (d.oiChange1h !== null && Math.abs(d.oiChange1h) >= 2 && (d.oiHistory?.length ?? 0) >= 2) eligible.push('oi');
  if (d.longShortRatio !== null && (d.longShortRatio >= 1.5 || d.longShortRatio <= 0.67) && (d.longShortHistory?.length ?? 0) >= 2) eligible.push('positioning');
  const seed = hash(m.symbol + m.asOf);
  const hasDerivatives = (d.oiHistory?.length ?? 0) >= 2 || (d.longShortHistory?.length ?? 0) >= 2;
  const hasDerivativesStory = hasDerivatives && eligible.some(style => style === 'oi' || style === 'positioning');
  const dashboardChoices: DashboardTemplate[] = ['market', 'timeframes', ...(hasDerivativesStory ? ['derivatives' as const] : [])];
  const previous = previousDashboard(context);
  const freshDashboards = dashboardChoices.filter(template => template !== previous);
  const dashboards = freshDashboards.length ? freshDashboards : dashboardChoices;
  const dashboard = dashboards[hash(`${seed}:dashboard`) % dashboards.length]!;
  const compatibleStyles = dashboard === 'derivatives'
    ? eligible.filter(style => style === 'oi' || style === 'positioning')
    : eligible.filter(style => style === 'price' || style === 'volume');
  const alternatives = compatibleStyles.filter(style => style !== context.recentPosts[0]?.metadata.editorialStyle);
  const choices = alternatives.length ? alternatives : compatibleStyles;
  const style = choices[seed % choices.length]!;
  const firstTimeframe: TechnicalTimeframe = hash(`${seed}:timeframe`) % 2 === 0 ? '1h' : '4h';
  const technicalCount = dashboard === 'timeframes' ? 1 : style === 'price' ? 2 : 1 + hash(`${seed}:count`) % 2;
  const technicalTimeframes: TechnicalTimeframe[] = technicalCount === 2
    ? [firstTimeframe, firstTimeframe === '1h' ? '4h' : '1h']
    : [firstTimeframe];
  const chartPlan: ChartPlan = { technicalTimeframes, dashboard, imageCount: technicalTimeframes.length + 1 };
  return { style, layout: seed % 3, chartPlan } satisfies PostPresentation;
}

export function chartPlanForWriter(plan: ChartPlan) {
  const dashboardData: Record<DashboardTemplate, string[]> = {
    market: ['spot price history', 'spot volume history', '24h change', 'hourly RSI', 'hourly volume ratio'],
    derivatives: ['open interest history', 'long-short account history', 'funding rate', 'one-hour OI change'],
    timeframes: ['15m/1h/4h trend', '15m/1h/4h price change', '15m/1h/4h RSI', '15m/1h/4h volume ratio'],
  };
  return {
    imageCount: plan.imageCount,
    charts: [
      ...plan.technicalTimeframes.map(timeframe => ({ template: `technical-${timeframe}`, visibleData: ['closed candles', 'volume', 'EMA20/50/200', 'support/resistance'] })),
      { template: `dashboard-${plan.dashboard}`, visibleData: dashboardData[plan.dashboard] },
    ],
  };
}
export const STYLE_PROMPTS: Record<EditorialStyle, string> = {
  price: 'Góc nhìn vùng giá: tập trung vùng hỗ trợ/kháng cự hoặc xu hướng thực có, đối chiếu các khung theo chartPlan. Không giả định đang giằng co khi dữ liệu chưa thể hiện. Cách mở và kết do format quyết định.',
  volume: 'Góc nhìn giao dịch: tập trung volume và phản ứng giá. Phân biệt giao dịch với dòng tiền ròng; không suy ra cá voi gom hàng từ volume. Cách mở và kết do format quyết định.',
  oi: 'Góc nhìn vị thế mở: tập trung biến động OI, đối chiếu giá và funding. OI tăng là hợp đồng mở tăng, không tự chứng minh tiền mới mua hay squeeze. Cách mở và kết do format quyết định.',
  positioning: 'Góc nhìn đám đông: tập trung tỷ lệ tài khoản long/short, đối chiếu giá và OI. Đây là tỷ lệ tài khoản, không phải khối lượng vị thế; không đảm bảo đảo chiều. Cách mở và kết do format quyết định.',
};
export function inlineFacts(context: AgentContext): Record<string, string> {
  const m = context.market, d = m.derivatives;
  const n = (v: number) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7, useGrouping: false }).format(v);
  const facts: Record<string, string> = { asset: '$' + m.symbol.replace(/USDT$/, ''), price: n(m.price), change: m.change24h.toFixed(2) + '%', quote_volume: n(m.quoteVolume) + ' USDT' };
  for (const [tf, name] of [['15m', 'quarter'], ['1h', 'hour'], ['4h', 'fourhour']] as const) {
    const f = m.frames[tf];
    facts[name + '_close'] = n(f.price);
    facts[name + '_rsi'] = f.technical.rsi.toFixed(1);
    facts[name + '_volume'] = f.volume.ratio.toFixed(2) + 'x';
    facts[name + '_ema_fast'] = n(f.technical.ema20);
    facts[name + '_ema_medium'] = n(f.technical.ema50);
    facts[name + '_ema_slow'] = n(f.technical.ema200);
    if (f.levels.support[0] !== undefined) facts[name + '_support'] = n(f.levels.support[0]);
    if (f.levels.resistance[0] !== undefined) facts[name + '_resistance'] = n(f.levels.resistance[0]);
  }
  if (d.funding !== null) facts.funding = (d.funding * 100).toFixed(4) + '%';
  if (d.openInterest !== null) facts.oi = n(d.openInterest);
  if (d.oiChange1h !== null) facts.oi_change = d.oiChange1h.toFixed(2) + '%';
  if (d.longShortRatio !== null) facts.long_short = n(d.longShortRatio);
  return facts;
}
export const fillFacts = (text: string, facts: Record<string, string>) => text.replace(/\{\{([a-z_]+)\}\}/g, (token, name: string) => facts[name] ?? token);
