import axios from 'axios';
import { z } from 'zod';
import { env } from '../config/env.js';
import { SYMBOL_PATTERN, STABLE_ASSETS, LEVERAGED_ASSETS, type Timeframe } from '../config/constants.js';
import type { Candle, Derivatives, Ticker } from '../types.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const numeric = z.union([z.string(), z.number()]).transform(Number).pipe(z.number().finite());
const tickerSchema = z.object({ symbol: z.string(), lastPrice: numeric, priceChangePercent: numeric, quoteVolume: numeric, count: numeric });
let queue: Promise<unknown> = Promise.resolve();
let blockedUntil = 0;
async function request(baseURL: string, endpoint: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const task = queue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() < blockedUntil) throw new Error('BINANCE_BACKOFF');
      await sleep(150);
      try { return (await axios.get<unknown>(endpoint, { baseURL, params, timeout: 15000, maxRedirects: 0 })).data; }
      catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 418 || status === 429) {
          const retry = Number(axios.isAxiosError(error) ? error.response?.headers['retry-after'] : 60);
          blockedUntil = Date.now() + Math.max(60000, (Number.isFinite(retry) ? retry : 60) * 1000);
          throw new Error('BINANCE_BACKOFF');
        }
        if (attempt === 2 || (status && status < 500)) throw new Error(`BINANCE_REQUEST_FAILED_${status ?? 'NETWORK'}`);
        await sleep(1000 * 2 ** attempt);
      }
    }
    throw new Error('BINANCE_REQUEST_FAILED');
  });
  queue = task.catch(() => undefined);
  return task;
}

let marketCache: { expires: number; symbols: Set<string> } | undefined;
export async function tradableSymbols(): Promise<Set<string>> {
  if (marketCache && marketCache.expires > Date.now()) return marketCache.symbols;
  const exchange = z.object({ symbols: z.array(z.object({ symbol: z.string(), status: z.string(), baseAsset: z.string(), quoteAsset: z.string(), isSpotTradingAllowed: z.boolean().optional() })) }).parse(await request(env.BINANCE_BASE_URL, '/api/v3/exchangeInfo'));
  const symbols = new Set(exchange.symbols.filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.isSpotTradingAllowed !== false && SYMBOL_PATTERN.test(s.symbol) && !STABLE_ASSETS.has(s.baseAsset) && !LEVERAGED_ASSETS.has(s.baseAsset)).map(s => s.symbol));
  marketCache = { symbols, expires: Date.now() + 3600000 };
  return symbols;
}
export async function tickers(): Promise<Ticker[]> {
  const allowed = await tradableSymbols();
  const data = z.array(tickerSchema).parse(await request(env.BINANCE_BASE_URL, '/api/v3/ticker/24hr'));
  return data.filter(t => allowed.has(t.symbol) && t.lastPrice > 0).map(t => ({ symbol: t.symbol, price: t.lastPrice, change24h: t.priceChangePercent, quoteVolume: t.quoteVolume, trades: t.count }));
}
export async function ticker(symbol: string): Promise<Ticker> {
  if (!(await tradableSymbols()).has(symbol)) throw new Error('UNSUPPORTED_SYMBOL');
  const t = tickerSchema.parse(await request(env.BINANCE_BASE_URL, '/api/v3/ticker/24hr', { symbol }));
  if (t.lastPrice <= 0) throw new Error('INVALID_MARKET_PRICE');
  return { symbol, price: t.lastPrice, change24h: t.priceChangePercent, quoteVolume: t.quoteVolume, trades: t.count };
}
export async function klines(symbol: string, interval: Timeframe): Promise<Candle[]> {
  const raw = z.array(z.array(z.union([z.string(), z.number()])).min(7)).parse(await request(env.BINANCE_BASE_URL, '/api/v3/klines', { symbol, interval, limit: 300 }));
  const now = Date.now();
  const duration = { '15m': 900000, '1h': 3600000, '4h': 14400000 }[interval];
  const candles = raw.map(r => ({ time: Number(r[0]) / 1000, open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]), closeTime: Number(r[6]) })).filter(c => c.closeTime < now);
  if (candles.length < 250) throw new Error('INSUFFICIENT_CANDLES');
  if (candles.some((c, i) => !Object.values(c).every(Number.isFinite) || c.low <= 0 || c.volume < 0 || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close) || (i > 0 && (c.time - candles[i - 1]!.time) * 1000 !== duration))) throw new Error('INVALID_CANDLES');
  if (now - candles.at(-1)!.closeTime > duration * 2) throw new Error('STALE_CANDLES');
  return candles;
}

let futuresCache: { expires: number; symbols: Set<string> } | undefined;
async function futuresSymbols(): Promise<Set<string>> {
  if (futuresCache && futuresCache.expires > Date.now()) return futuresCache.symbols;
  const data = z.object({ symbols: z.array(z.object({ symbol: z.string(), status: z.string(), contractType: z.string() })) }).parse(await request(env.BINANCE_FUTURES_URL, '/fapi/v1/exchangeInfo'));
  const symbols = new Set(data.symbols.filter(s => s.status === 'TRADING' && s.contractType === 'PERPETUAL').map(s => s.symbol));
  futuresCache = { expires: Date.now() + 3600000, symbols };
  return symbols;
}
export async function derivatives(symbol: string): Promise<Derivatives> {
  const result: Derivatives = { funding: null, openInterest: null, oiChange1h: null, longShortRatio: null, unavailable: [] };
  if (!env.ENABLE_FUTURES) { result.unavailable.push('futures_disabled'); return result; }
  try { if (!(await futuresSymbols()).has(symbol)) { result.unavailable.push('no_matching_perpetual_contract'); return result; } }
  catch { result.unavailable.push('futures_exchange_unavailable'); return result; }
  try {
    const row = z.object({ lastFundingRate: numeric, time: numeric }).parse(await request(env.BINANCE_FUTURES_URL, '/fapi/v1/premiumIndex', { symbol }));
    if (Math.abs(Date.now() - row.time) > 300000) throw new Error('STALE_FUNDING');
    result.funding = row.lastFundingRate;
  } catch { result.unavailable.push('funding'); }
  try {
    const row = z.object({ openInterest: numeric, time: numeric }).parse(await request(env.BINANCE_FUTURES_URL, '/fapi/v1/openInterest', { symbol }));
    if (Math.abs(Date.now() - row.time) > 300000 || row.openInterest < 0) throw new Error('INVALID_OI');
    result.openInterest = row.openInterest;
  } catch { result.unavailable.push('openInterest'); }
  try {
    const rows = z.array(z.object({ sumOpenInterest: numeric, timestamp: numeric })).min(2).parse(await request(env.BINANCE_FUTURES_URL, '/futures/data/openInterestHist', { symbol, period: '1h', limit: 48 }));
    rows.sort((a, b) => a.timestamp - b.timestamp);
    const previous = rows.at(-2), current = rows.at(-1);
    if (rows.some((row, index) => row.sumOpenInterest < 0 || row.timestamp > Date.now() + 60000 || (index > 0 && row.timestamp - rows[index - 1]!.timestamp !== 3600000))) throw new Error('INVALID_OI_HISTORY');
    if (!previous || !current || previous.sumOpenInterest <= 0 || current.timestamp - previous.timestamp !== 3600000 || Date.now() - current.timestamp > 7200000) throw new Error('INVALID_OI_HISTORY');
    result.oiChange1h = (current.sumOpenInterest / previous.sumOpenInterest - 1) * 100;
    result.oiHistory = rows.map(row => ({ time: row.timestamp / 1000, value: row.sumOpenInterest }));
  } catch { result.unavailable.push('oiChange1h'); }
  try {
    const rows = z.array(z.object({ longShortRatio: numeric, longAccount: numeric, shortAccount: numeric, timestamp: numeric })).min(1).parse(await request(env.BINANCE_FUTURES_URL, '/futures/data/globalLongShortAccountRatio', { symbol, period: '1h', limit: 48 }));
    rows.sort((a, b) => a.timestamp - b.timestamp);
    const row = rows.at(-1)!;
    if (Date.now() - row.timestamp > 7200000 || rows.some((r, i) => r.timestamp > Date.now() + 60000 || r.longShortRatio <= 0 || r.longAccount < 0 || r.longAccount > 1 || r.shortAccount <= 0 || r.shortAccount > 1 || Math.abs(r.longAccount + r.shortAccount - 1) > 0.01 || (i > 0 && r.timestamp - rows[i - 1]!.timestamp !== 3600000))) throw new Error('INVALID_LONG_SHORT');
    result.longShortRatio = row.longShortRatio;
    result.longShortHistory = rows.map(r => ({ time: r.timestamp / 1000, ratio: r.longShortRatio, long: r.longAccount * 100, short: r.shortAccount * 100 }));
  } catch { result.unavailable.push('longShortRatio'); }
  return result;
}
