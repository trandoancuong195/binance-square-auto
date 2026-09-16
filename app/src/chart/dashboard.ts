import type { Snapshot } from '../types.js';
import type { EditorialStyle } from '../ai/presentation.js';

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

export function dashboardHtml(snapshot: Snapshot, style: EditorialStyle): string {
  const m = snapshot.analysis, theme = chartThemes[style], candles = m.frames['1h'].candles.slice(-48), d = m.derivatives;
  const price = candles.map(c => ({ time: c.closeTime / 1000, value: c.close }));
  const volume = candles.map(c => ({ time: c.closeTime / 1000, value: c.volume }));
  const oi = d.oiHistory ?? [], ls = d.longShortHistory ?? [];
  const allTimes = [...price, ...oi, ...ls].map(p => p.time);
  const start = Math.min(...allTimes), end = Math.max(...allTimes);
  const stamp = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ');
  const label = (x: number, y: number, value: string, size = 15, color = theme.muted) => '<text x="' + x + '" y="' + y + '" fill="' + color + '" font-size="' + size + '">' + escape(value) + '</text>';
  function panel(x: number, y: number, title: string, points: Point[], mode: 'line' | 'bars' | 'accounts', color: string) {
    let svg = '<g>' + label(x, y, title, 20, theme.text);
    const left = x + 72, top = y + 25, width = 445, height = 230;
    if (points.length < 2) return svg + label(x + 30, y + 125, 'Chưa có chuỗi dữ liệu hợp lệ') + '</g>';
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
  const panels = [
    { key: 'price', title: 'Giá spot · nến đóng một giờ · USDT', points: price, mode: 'line' as const, color: theme.accent },
    { key: 'volume', title: 'Volume spot · số lượng tài sản cơ sở', points: volume, mode: 'bars' as const, color: theme.up },
    { key: 'oi', title: 'Open Interest · số lượng · mẫu một giờ', points: oi, mode: 'line' as const, color: theme.accent },
    { key: 'positioning', title: 'Long / Short · % tài khoản futures', points: ls.map(p => ({ time: p.time, value: p.long, short: p.short })), mode: 'accounts' as const, color: theme.up },
  ].sort((a, b) => Number(b.key === style) - Number(a.key === style));
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" font-family="Arial,sans-serif"><rect width="1200" height="900" fill="' + theme.bg + '"/>';
  svg += label(35, 45, m.symbol + ' · MARKET PULSE', 28, theme.text);
  svg += label(35, 77, 'Dữ liệu gần nhất · ' + m.asOf + ' · Không suy ra hướng mua/bán từ OI', 16);
  panels.forEach((p, i) => { svg += panel(30 + (i % 2) * 590, 120 + Math.floor(i / 2) * 355, p.title, p.points, p.mode, p.color); });
  svg += label(35, 866, 'Binance spot + USDⓈ-M futures · Thời gian UTC · Các chuỗi có thể kết thúc khác thời điểm', 14) + '</svg>';
  return '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">' + svg + '</body></html>';
}
