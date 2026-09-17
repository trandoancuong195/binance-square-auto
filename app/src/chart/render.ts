import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appRoot, env, outputRoot } from '../config/env.js';
import { SYMBOL_PATTERN } from '../config/constants.js';
import { ema } from '../indicators/index.js';
import type { Snapshot } from '../types.js';
import { presentation, type PostPresentation } from '../ai/presentation.js';
import { chartThemes, dashboardHtml } from './dashboard.js';

async function loadChartBundle(): Promise<string> {
  const filename = 'lightweight-charts.standalone.production.js';
  const candidates = new Set([path.join(appRoot, 'node_modules', 'lightweight-charts', 'dist', filename)]);
  try {
    // Resolve using ESM exports. Package entry points may live at the root or inside dist.
    const entryDirectory = path.dirname(fileURLToPath(import.meta.resolve('lightweight-charts')));
    candidates.add(path.join(entryDirectory, filename));
    candidates.add(path.join(entryDirectory, 'dist', filename));
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    // The directly installed browser bundle can still exist even if package exports cannot be resolved.
  }
  for (const candidate of candidates) {
    try { return await readFile(candidate, 'utf8'); }
    catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('CHART_LIBRARY_BUNDLE_NOT_FOUND');
}

function chartFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const nativeCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '';
  if (message === 'INVALID_CHART_PATH') return { code: 'INVALID_CHART_PATH', hint: 'Chart symbol or snapshot ID is invalid.' };
  if (message === 'INVALID_CHART_PLAN') return { code: 'INVALID_CHART_PLAN', hint: 'The selected chart plan must contain one dashboard and at most two technical charts.' };
  if (message === 'CHART_LIBRARY_BUNDLE_NOT_FOUND') return { code: 'CHART_LIBRARY_BUNDLE_NOT_FOUND', hint: 'The Lightweight Charts standalone bundle is missing. Check app/node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js.' };
  if (/Running as root without --no-sandbox/i.test(message)) return { code: 'CHART_BROWSER_RUNNING_AS_ROOT', hint: 'Run PM2 and Chromium as a non-root account with the browser installed for that account.' };
  if (/No usable sandbox|SUID sandbox|Failed to move to new namespace|Operation not permitted.*sandbox/i.test(message)) return { code: 'CHART_BROWSER_SANDBOX_UNAVAILABLE', hint: 'Configure Chromium sandbox support for the application account on this VPS.' };
  if (/Could not find Chrome|Could not find Chromium|Browser was not found|executable.*does not exist/i.test(message)) return { code: 'CHART_BROWSER_NOT_INSTALLED', hint: 'Install Puppeteer Chrome as the same account that runs PM2, or check PUPPETEER_EXECUTABLE_PATH.' };
  if (/error while loading shared libraries/i.test(message)) {
    const library = message.match(/lib[A-Za-z0-9_+.-]+\.so(?:\.[0-9]+)*/)?.[0] ?? 'unknown';
    return { code: 'CHART_BROWSER_MISSING_LIBRARY', hint: 'Install the missing Chromium system dependency for this VPS OS.', library };
  }
  if (nativeCode === 'EACCES' || nativeCode === 'EPERM') return { code: 'CHART_PERMISSION_DENIED', hint: 'Check application account permissions for the output directory, browser executable and cache.' };
  if (nativeCode === 'ENOSPC') return { code: 'CHART_DISK_FULL', hint: 'Check available disk space on the VPS.' };
  if (nativeCode === 'ENOENT' || nativeCode === 'MODULE_NOT_FOUND' || nativeCode === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return { code: 'CHART_RESOURCE_NOT_FOUND', hint: 'Check installed chart dependencies, browser and deployment files at the reported stage.' };
  if (error instanceof Error && error.name === 'TimeoutError') return { code: 'CHART_RENDER_TIMEOUT', hint: 'Chart or browser did not become ready before the timeout.' };
  if (/Failed to launch the browser process/i.test(message)) return { code: 'CHART_BROWSER_LAUNCH_FAILED', hint: 'Chromium could not launch. Check browser installation and host requirements.' };
  return { code: 'CHART_RENDER_FAILED', hint: 'Chart rendering failed at the reported stage.' };
}

export async function renderCharts(snapshot: Snapshot, display: PostPresentation = presentation({ market: snapshot.analysis, recentPosts: [], activeSeries: [], previousThesis: null })): Promise<string[]> {
  const theme = chartThemes[display.style];
  let stage = 'load_chart_library';
  let timeframe: string | null = null;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  let scriptFailed = false;
  try {
    if (!SYMBOL_PATTERN.test(snapshot.analysis.symbol) || !/^\d+$/.test(snapshot.id)) throw new Error('INVALID_CHART_PATH');
    const bundle = await loadChartBundle();
    const directory = path.join(snapshot.analysis.symbol, snapshot.analysis.asOf.slice(0, 10), snapshot.id);
    stage = 'create_output_directory';
    await mkdir(path.join(outputRoot, directory), { recursive: true });
    stage = 'launch_browser';
    browser = await puppeteer.launch({ headless: true, ...(env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: env.PUPPETEER_EXECUTABLE_PATH } : {}) });
    stage = 'create_page';
    const page = await browser.newPage();
    page.on('pageerror', () => { scriptFailed = true; });
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', request => { void request.abort(); });
    const outputs: string[] = [];
    if (display.chartPlan.imageCount !== display.chartPlan.technicalTimeframes.length + 1
      || display.chartPlan.imageCount > 3 || display.chartPlan.technicalTimeframes.length > 2) throw new Error('INVALID_CHART_PLAN');
    for (const tf of display.chartPlan.technicalTimeframes) {
      timeframe = tf;
      stage = 'render_template';
      scriptFailed = false;
      const frame = snapshot.analysis.frames[tf];
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:${theme.bg};color:${theme.text};font-family:Arial,sans-serif}header{height:90px;padding:18px 28px}h1{font-size:24px;margin:0 0 8px}p{margin:0;color:${theme.muted}}#chart{height:650px}footer{height:60px;padding:14px 28px;color:${theme.muted};font-size:14px}</style></head><body><header><h1 id="title"></h1><p id="subtitle"></p></header><div id="chart"></div><footer>Closed candles · EMA 20 / 50 / 200 · Binance market data · Charts by TradingView Lightweight Charts</footer></body></html>`);
      await page.addScriptTag({ content: bundle });
      const closes = frame.candles.map(c => c.close);
      const series = [20, 50, 200].map(period => ({ period, data: ema(closes, period).flatMap((value, i) => value === null ? [] : [{ time: frame.candles[i]!.time, value }]).slice(-120) }));
      const payload = JSON.stringify({ symbol: snapshot.analysis.symbol, asOf: snapshot.analysis.asOf, price: snapshot.analysis.price, change: snapshot.analysis.change24h, score: snapshot.analysis.trendScore, theme, tf, candles: frame.candles.slice(-120), series, levels: frame.levels }).replace(/</g, '\u003c');
      await page.addScriptTag({ content: `(() => {
        const data = ${payload};
        document.querySelector('#title').textContent = data.symbol + ' · ' + data.tf.toUpperCase() + ' · ' + data.price + ' USDT';
        document.querySelector('#subtitle').textContent = '24h: ' + data.change.toFixed(2) + '% | Trend Score: ' + data.score + ' | ' + data.asOf;
        const chart = LightweightCharts.createChart(document.querySelector('#chart'), {width:1200,height:650,layout:{background:{color:data.theme.bg},textColor:data.theme.muted},grid:{vertLines:{color:data.theme.grid},horzLines:{color:data.theme.grid}},timeScale:{timeVisible:true},rightPriceScale:{scaleMargins:{top:0.08,bottom:0.26}},handleScroll:false,handleScale:false});
        const candle = chart.addCandlestickSeries({upColor:data.theme.up,downColor:data.theme.down,borderVisible:false,wickUpColor:data.theme.up,wickDownColor:data.theme.down,priceFormat:{type:'price',precision:Math.min(12,Math.max(2,4-Math.floor(Math.log10(data.price)))),minMove:Math.pow(10,-Math.min(12,Math.max(2,4-Math.floor(Math.log10(data.price)))))}});
        candle.setData(data.candles.map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close})));
        const volume=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'volume'});
        volume.priceScale().applyOptions({scaleMargins:{top:0.8,bottom:0}});
        volume.setData(data.candles.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?data.theme.up+'88':data.theme.down+'88'})));
        const colors=[data.theme.accent,data.theme.up,data.theme.down];
        data.series.forEach((s,i)=>chart.addLineSeries({color:colors[i],lineWidth:2,priceLineVisible:false,lastValueVisible:false,title:'EMA'+s.period}).setData(s.data));
        data.levels.support.forEach(price=>candle.createPriceLine({price,color:data.theme.up,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'S'}));
        data.levels.resistance.forEach(price=>candle.createPriceLine({price,color:data.theme.down,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'R'}));
        chart.timeScale().fitContent();
        window.chartReady = true;
      })();` });
      stage = 'wait_chart_ready';
      if (scriptFailed) throw new Error('CHART_SCRIPT_FAILED');
      await page.waitForFunction('window.chartReady === true');
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const relativePath = path.join(directory, `${tf}.png`);
      stage = 'save_png';
      await writeFile(path.join(outputRoot, relativePath), await page.screenshot({ type: 'png' }));
      outputs.push(relativePath.split(path.sep).join('/'));
    }
    timeframe = `dashboard-${display.chartPlan.dashboard}`;
    stage = 'render_dashboard';
    scriptFailed = false;
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 });
    await page.setContent(dashboardHtml(snapshot, display.style, display.chartPlan.dashboard));
    await page.evaluate(() => document.fonts.ready);
    const dashboardPath = path.join(directory, 'dashboard.png');
    stage = 'save_png';
    await writeFile(path.join(outputRoot, dashboardPath), await page.screenshot({ type: 'png' }));
    outputs.push(dashboardPath.split(path.sep).join('/'));
    return outputs;
  } catch (error) {
    const failure = scriptFailed || (error instanceof Error && error.message === 'CHART_SCRIPT_FAILED')
      ? { code: 'CHART_SCRIPT_FAILED', hint: 'Chart JavaScript failed. Check the Lightweight Charts bundle and template compatibility.' }
      : chartFailure(error);
    // Do not log browser stderr or raw errors, which may contain environment values and payload excerpts.
    console.error(JSON.stringify({ event: 'chart_render_failed', symbol: snapshot.analysis.symbol, snapshot_id: snapshot.id, timeframe, stage, ...failure }));
    throw new Error(failure.code);
  } finally {
    if (browser) {
      try { await browser.close(); }
      catch { console.error(JSON.stringify({ event: 'chart_browser_close_failed', symbol: snapshot.analysis.symbol, snapshot_id: snapshot.id })); }
    }
  }
}
