import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const app = path.dirname(fileURLToPath(import.meta.url));
process.chdir(app);
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
process.env.INTERNAL_API_KEY = 'local-ai-verification-not-a-server-key';
process.env.DB_CONTEXT_ENABLED = 'false';
const { env } = await import('./dist/config/env.js');
const { writeDraft } = await import('./dist/ai/writer.js');
const { planPost } = await import('./dist/series/decision-engine.js');
const { qualityGate } = await import('./dist/ai/quality.js');
const { draftSchema } = await import('./dist/ai/types.js');
const directory = path.join(app, 'output', 'ai-verification-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });
try {
  const snapshotFile = process.argv[2] ?? 'output/verification-2026-09-15T10-23-42-043Z/analysis.json';
  const analysis = JSON.parse(await readFile(snapshotFile, 'utf8'));
  const context = { market: analysis, recentPosts: [], activeSeries: [], previousThesis: null };
  console.info(JSON.stringify({ event: 'live_ai_test_started', symbol: analysis.symbol, snapshotAsOf: analysis.asOf, model: env.AI_MODEL, fallbackModels: env.AI_FALLBACK_MODELS, databaseUsed: false }));
  const started = Date.now();
  const draft = await writeDraft(context, planPost(context));
  draftSchema.parse(draft.output);
  assert.ok(!/[{}]/.test(draft.content), 'Unresolved placeholders');
  const quality = qualityGate(draft.content, draft.output, context);
  const report = { passed: quality.passed, aiModel: draft.aiModel, editorialStyle: draft.editorialStyle, elapsedMs: Date.now() - started, snapshotAsOf: analysis.asOf, databaseUsed: false, published: false, quality };
  await writeFile(path.join(directory, 'draft.txt'), draft.content);
  await writeFile(path.join(directory, 'output.json'), JSON.stringify(draft.output, null, 2));
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ event: 'live_ai_test_complete', directory, ...report }));
  if (!quality.passed) process.exitCode = 1;
} catch (error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message) ? error.message : 'AI_VERIFICATION_FAILED';
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({ passed: false, code, databaseUsed: false, published: false }, null, 2));
  console.error(JSON.stringify({ event: 'live_ai_test_failed', code, directory }));
  process.exitCode = 1;
}
