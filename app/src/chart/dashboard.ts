import type { Snapshot } from '../types.js';
import type { DashboardTemplate, EditorialStyle } from '../ai/presentation.js';

export const chartThemes = {
  price: { bg: '#101d32', text: '#edf5ff', muted: '#a4bad5', grid: '#263d57', up: '#39d6ae', down: '#ff7e91', accent: '#69bfff' },
  volume: { bg: '#fff8ec', text: '#322515', muted: '#756347', grid: '#e7d8bd', up: '#087f6e', down: '#cf4a57', accent: '#b86c05' },
  oi: { bg: '#211830', text: '#f3eaff', muted: '#baa7d1', grid: '#453156', up: '#5ee3c4', down: '#ff8bad', accent: '#c19aff' },
  positioning: { bg: '#eef8fa', text: '#12363f', muted: '#496f78', grid: '#c8dfe3', up: '#087d8f', down: '#dc643c', accent: '#185ac4' },
};
type Point = { time: number; value: number; short?: number };
const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escape = (s: string) => s.replace(/[&<>"']/g, c => entities[c]!);
const number = (n: number) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 }).format(n);

export function dashboardHtml(snapshot: Snapshot, style: EditorialStyle, template: DashboardTemplate): string {
  const m = snapshot.analysis, theme = chartThemes[style], candles = m.frames['1h'].candles.slice(-48), d = m.derivatives;
  const price = candles.map(c => ({ time: c.closeTime / 1000, value: c.close }));
  const volume = candles.map(c => ({ time: c.closeTime / 1000, value: c.volume }));
  const oi = d.oiHistory ?? [], ls = d.longShortHistory ?? [];
  const stamp = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ');
  const label = (x: number, y: number, value: string, size = 15, color = theme.muted) => '<text x="' + x + '" y="' + y + '" fill="' + color + '" font-size="' + size + '">' + escape(value) + '</text>';
  const rect = (x: number, y: number, width: number, height: number, fill: string, radius = 16) => '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" rx="' + radius + '" fill="' + fill + '"/>';
  function panel(x: number, y: number, title: string, points: Point[], mode: 'line' | 'bars' | 'accounts', color: string, width = 1040, height = 225) {
    let svg = '<g>' + label(x, y, title, 20, theme.text);
    const left = x + 72, top = y + 25;
    if (points.length < 2) return svg + label(x + 30, y + 125, 'Chưa có chuỗi dữ liệu hợp lệ') + '</g>';
    const start = Math.min(...points.map(p => p.time)), end = Math.max(...points.map(p => p.time));
    const low = mode === 'line' ? Math.min(...points.map(p => p.value)) : 0;
    const high = mode === 'accounts' ? 100 : Math.max(...points.map(p => p.value));
    const padding = mode === 'line' ? Math.max((high - low) * 0.08, Math.abs(high) * 0.001, 0.00000001) : 0;
    const min = low - padding, range = Math.max(high + padding - min, 0.00000001);
    const px = (time: number) => left + (time - start) / Math.max(end - start, 1) * width;
    const py = (value: number) => top + height - (value - min) / range * height;
    for (let i = 0; i <= 4; i++) {
      const v = min + range * i / 4, yy = py(v);
      svg += '<path d="M ' + left + ' ' + yy + ' h ' + width + '" stroke="' + theme.grid + '"/>' + label(x, yy + 5, number(v), 12);
    }
    if (mode === 'line') {
      svg += '<polyline fill="none" stroke="' + color + '" stroke-width="3" points="' + points.map(p => px(p.time) + ',' + py(p.value)).join(' ') + '"/>';
    } else {
      const bar = Math.max(2, width / Math.max(points.length, 48) * 0.7);
      for (const p of points) {
        const h = (p.value - min) / range * height;
        svg += '<rect x="' + (px(p.time) - bar / 2) + '" y="' + py(p.value) + '" width="' + bar + '" height="' + h + '" fill="' + color + '"/>';
        if (mode === 'accounts') svg += '<rect x="' + (px(p.time) - bar / 2) + '" y="' + top + '" width="' + bar + '" height="' + ((p.short ?? 0) / 100 * height) + '" fill="' + theme.down + '"/>';
      }
    }
    svg += label(left, top + height + 24, stamp(start), 12) + label(left + width - 115, top + height + 24, stamp(end), 12);
    if (mode === 'accounts') {
      const last = points.at(-1)!;
      svg += label(left, top + height + 47, 'Long ' + number(last.value) + '%', 14, color);
      svg += label(left + 155, top + height + 47, 'Short ' + number(last.short ?? 0) + '%', 14, theme.down);
      return svg + '</g>';
    }
    return svg + label(left, top + height + 47, 'Mẫu gần nhất: ' + number(points.at(-1)!.value), 13) + '</g>';
  }
  function metricCards(items: { title: string; value: string; color?: string }[]) {
    const width = 265;
    return items.map((item, index) => {
      const x = 35 + index * 285;
      return rect(x, 795, width, 55, theme.grid, 12) + label(x + 16, 817, item.title, 12) + label(x + 16, 840, item.value, 18, item.color ?? theme.text);
    }).join('');
  }
  function timeframeCards() {
    return (['15m', '1h', '4h'] as const).map((timeframe, index) => {
      const frame = m.frames[timeframe], x = 35 + index * 385, y = 145, width = 360, height = 620;
      const trendColor = frame.trend === 'bullish' ? theme.up : frame.trend === 'bearish' ? theme.down : theme.muted;
      const rsiWidth = Math.max(0, Math.min(300, frame.technical.rsi / 100 * 300));
      const volumeWidth = Math.max(0, Math.min(300, frame.volume.ratio / 4 * 300));
      let svg = rect(x, y, width, height, theme.grid);
      svg += label(x + 24, y + 42, timeframe.toUpperCase(), 26, theme.text);
      svg += label(x + 24, y + 78, frame.trend.toUpperCase(), 15, trendColor);
      svg += label(x + 24, y + 125, 'Giá đóng', 13) + label(x + 24, y + 153, number(frame.price), 22, theme.text);
      svg += label(x + 24, y + 198, 'Thay đổi khung', 13) + label(x + 24, y + 226, frame.change.toFixed(2) + '%', 22, frame.change >= 0 ? theme.up : theme.down);
      svg += label(x + 24, y + 276, 'RSI · ' + frame.technical.rsi.toFixed(1), 14);
      svg += rect(x + 24, y + 292, 300, 16, theme.bg, 8) + rect(x + 24, y + 292, rsiWidth, 16, theme.accent, 8);
      svg += label(x + 24, y + 350, 'Volume ratio · ' + frame.volume.ratio.toFixed(2) + 'x', 14);
      svg += rect(x + 24, y + 366, 300, 16, theme.bg, 8) + rect(x + 24, y + 366, volumeWidth, 16, theme.up, 8);
      svg += label(x + 24, y + 430, 'EMA 20 / 50 / 200', 13);
      svg += label(x + 24, y + 458, [frame.technical.ema20, frame.technical.ema50, frame.technical.ema200].map(number).join(' / '), 14, theme.text);
      svg += label(x + 24, y + 510, 'Hỗ trợ gần', 13) + label(x + 24, y + 537, frame.levels.support[0] === undefined ? 'Chưa xác định' : number(frame.levels.support[0]), 16, theme.up);
      svg += label(x + 24, y + 574, 'Kháng cự gần', 13) + label(x + 24, y + 601, frame.levels.resistance[0] === undefined ? 'Chưa xác định' : number(frame.levels.resistance[0]), 16, theme.down);
      return svg;
    }).join('');
  }
  const headings: Record<DashboardTemplate, { title: string; subtitle: string }> = {
    market: { title: 'MARKET FLOW', subtitle: 'Giá và volume spot trong các mẫu một giờ gần nhất' },
    derivatives: { title: 'DERIVATIVES PULSE', subtitle: 'Vị thế mở và tỷ lệ tài khoản futures · phần thiếu được ghi rõ' },
    timeframes: { title: 'MULTI-TIMEFRAME MAP', subtitle: 'So sánh dữ liệu nến đã đóng trên ba khung thời gian' },
  };
  const heading = headings[template];
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" font-family="Arial,sans-serif"><rect width="1200" height="900" fill="' + theme.bg + '"/>';
  svg += label(35, 45, m.symbol + ' · ' + heading.title, 28, theme.text);
  svg += label(35, 77, heading.subtitle + ' · ' + m.asOf, 16);
  if (template === 'market') {
    svg += panel(35, 125, 'Giá spot · nến đóng một giờ · USDT', price, 'line', theme.accent);
    svg += panel(35, 460, 'Volume spot · số lượng tài sản cơ sở', volume, 'bars', theme.up);
    svg += metricCards([
      { title: 'Biến động 24h', value: m.change24h.toFixed(2) + '%', color: m.change24h >= 0 ? theme.up : theme.down },
      { title: 'RSI một giờ', value: m.frames['1h'].technical.rsi.toFixed(1) },
      { title: 'Volume ratio', value: m.frames['1h'].volume.ratio.toFixed(2) + 'x' },
      { title: 'Trend Score', value: number(m.trendScore) },
    ]);
  } else if (template === 'derivatives') {
    svg += panel(35, 125, 'Open Interest · số lượng · mẫu một giờ', oi, 'line', theme.accent);
    svg += panel(35, 460, 'Long / Short · % tài khoản futures', ls.map(p => ({ time: p.time, value: p.long, short: p.short })), 'accounts', theme.up);
    svg += metricCards([
      { title: 'Funding', value: d.funding === null ? 'Thiếu dữ liệu' : (d.funding * 100).toFixed(4) + '%' },
      { title: 'OI hiện tại', value: d.openInterest === null ? 'Thiếu dữ liệu' : number(d.openInterest) },
      { title: 'OI thay đổi một giờ', value: d.oiChange1h === null ? 'Thiếu dữ liệu' : d.oiChange1h.toFixed(2) + '%' },
      { title: 'Long / Short', value: d.longShortRatio === null ? 'Thiếu dữ liệu' : number(d.longShortRatio) },
    ]);
  } else {
    svg += timeframeCards();
  }
  svg += label(35, 875, 'Binance spot + USDⓈ-M futures · Thời gian UTC · Không phải khuyến nghị giao dịch', 14) + '</svg>';
  return '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">' + svg + '</body></html>';
}
