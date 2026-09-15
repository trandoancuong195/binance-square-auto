import type { AgentContext } from '../types.js';

export type EditorialStyle = 'price' | 'volume' | 'oi' | 'positioning';
export function presentation(context: AgentContext) {
  const m = context.market, d = m.derivatives, f = m.frames['1h'];
  const eligible: EditorialStyle[] = ['price'];
  if (f.volume.ratio >= 1.2) eligible.push('volume');
  if (d.oiChange1h !== null && Math.abs(d.oiChange1h) >= 2 && (d.oiHistory?.length ?? 0) >= 2) eligible.push('oi');
  if (d.longShortRatio !== null && (d.longShortRatio >= 1.5 || d.longShortRatio <= 0.67) && (d.longShortHistory?.length ?? 0) >= 2) eligible.push('positioning');
  const seed = Array.from(m.symbol + m.asOf).reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 0);
  const alternatives = eligible.filter(style => style !== context.recentPosts[0]?.metadata.editorialStyle);
  const choices = alternatives.length ? alternatives : eligible;
  return { style: choices[seed % choices.length]!, layout: seed % 3 };
}
export const STYLE_PROMPTS: Record<EditorialStyle, string> = {
  price: 'Góc nhìn vùng giá: mở bằng sự giằng co hoặc vùng hợp lưu thực có, dẫn từ khung bốn giờ về một giờ. Giọng tâm sự quan sát: “tôi đang chú ý…”.',
  volume: 'Góc nhìn giao dịch: mở từ volume nổi bật, đối chiếu phản ứng giá. Phân biệt giao dịch với dòng tiền ròng; không suy ra cá voi gom hàng từ volume.',
  oi: 'Góc nhìn vị thế mở: dẫn từ biến động OI rồi đối chiếu giá và funding. OI tăng là hợp đồng mở tăng, không tự chứng minh tiền mới mua hay squeeze.',
  positioning: 'Góc nhìn đám đông: dẫn từ tỷ lệ tài khoản long/short, đối chiếu giá và OI. Đây là tỷ lệ tài khoản, không phải khối lượng vị thế; không đảm bảo đảo chiều.',
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
