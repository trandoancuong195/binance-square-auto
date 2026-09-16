import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.dirname(fileURLToPath(import.meta.url));
process.chdir(app);
// Config validation needs a URL, but this runner never imports the DB client or starts the server.
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
process.env.INTERNAL_API_KEY = 'local-chart-verification-not-an-api-key';
process.env.DB_CONTEXT_ENABLED = 'false';
process.env.AI_WRITER_ENABLED = 'false';
process.env.BINANCE_BASE_URL = 'https://api.binance.com';
process.env.BINANCE_FUTURES_URL = 'https://fapi.binance.com';
process.env.ENABLE_FUTURES = 'true';
process.env.PUPPETEER_EXECUTABLE_PATH = '';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
process.env.OUTPUT_DIR = 'output/verification-' + runId;
const { analyze } = await import('./dist/scanner/analysis.js');
const { renderCharts } = await import('./dist/chart/render.js');
const { presentation } = await import('./dist/ai/presentation.js');
const { outputRoot } = await import('./dist/config/env.js');

try {
  const snapshotArgument = process.argv.indexOf('--snapshot');
  const analysis = snapshotArgument >= 0
    ? JSON.parse(await readFile(path.resolve(process.argv[snapshotArgument + 1]), 'utf8'))
    : await analyze('BTCUSDT');
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, 'analysis.json'), JSON.stringify(analysis, null, 2));
  const context = { market: analysis, recentPosts: [], activeSeries: [], previousThesis: null };
  const report = {
    databaseUsed: false, aiCalled: false, source: snapshotArgument >= 0 ? 'saved-live-snapshot' : 'live-binance', symbol: analysis.symbol, asOf: analysis.asOf,
    selectedPresentation: presentation(context),
    candles: Object.fromEntries(Object.entries(analysis.frames).map(([tf, frame]) => [tf, frame.candles.length])),
    oiSamples: analysis.derivatives.oiHistory?.length ?? 0,
    longShortSamples: analysis.derivatives.longShortHistory?.length ?? 0,
    unavailable: analysis.derivatives.unavailable,
    images: [],
  };
  console.log(JSON.stringify({ event: 'live_analysis_complete', ...report }));
  const styles = ['price', 'volume', 'oi', 'positioning'];
  for (const [index, style] of styles.entries()) {
    const files = await renderCharts({ id: String(Date.now() + index), analysis }, style);
    assert.equal(files.length, 3);
    for (const [imageIndex, relative] of files.entries()) {
      const file = path.join(outputRoot, relative);
      const png = await readFile(file);
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.readUInt32BE(16), 1200);
      assert.equal(png.readUInt32BE(20), imageIndex === 2 ? 900 : 800);
      assert.ok(png.length > 10000);
      report.images.push({ style, file, bytes: png.length, width: 1200, height: png.readUInt32BE(20) });
    }
    console.log(JSON.stringify({ event: 'chart_style_verified', style, files }));
  }
  // Verify missing-derivatives display using the same real spot candles, with missing fields explicitly removed.
  const missing = { ...analysis, derivatives: { funding: null, openInterest: null, oiChange1h: null, longShortRatio: null, unavailable: ['verification_missing_data'] } };
  const fallback = await renderCharts({ id: String(Date.now()), analysis: missing }, 'price');
  report.missingDataDashboard = path.join(outputRoot, fallback[2]);
  await writeFile(path.join(outputRoot, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ event: 'verification_complete', report: path.join(outputRoot, 'report.json'), ...report }));
} catch (error) {
  console.error(JSON.stringify({ event: 'verification_failed', code: error instanceof Error ? error.message.slice(0, 180) : 'UNKNOWN' }));
  process.exitCode = 1;
}
