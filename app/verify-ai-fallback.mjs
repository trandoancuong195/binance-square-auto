import assert from 'node:assert/strict';
import axios from 'axios';
import { z } from 'zod';

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  INTERNAL_API_KEY: 'mock-internal-key-no-real-credentials',
  AI_BASE_URL: 'http://127.0.0.1:1/mock',
  AI_API_KEY: 'mock-ai-key', AI_MODEL: 'model-a',
  AI_FALLBACK_MODELS: 'model-a,model-b,model-b,model-c',
});
const { completeWithModel, complete } = await import('./dist/ai/client.js');
const schema = z.object({ ok: z.literal(true) }).strict();
const originalPost = axios.post;
const logs = [];
const originalLog = { info: console.info, warn: console.warn, error: console.error };
for (const key of Object.keys(originalLog)) console[key] = (...args) => logs.push(args.join(' '));
const success = () => ({ data: { choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] } });
function failure(status, code) {
  return new axios.AxiosError('mock failure', code ?? 'ERR_BAD_RESPONSE', undefined, undefined,
    status ? { status, data: {}, headers: {}, statusText: 'mock', config: {} } : undefined);
}
const passed = [];
async function scenario(name, handler, verify) {
  const calls = [];
  axios.post = async (_url, body) => {
    calls.push({ model: body.model, payload: JSON.parse(body.messages[1].content) });
    return handler(body, calls);
  };
  await verify(() => completeWithModel(schema, 'system', { task: 'mock' }), calls);
  passed.push(name);
}
try {
  await scenario('primary success and duplicate model removal', () => success(), async (run, calls) => {
    assert.deepEqual(await run(), { data: { ok: true }, model: 'model-a' });
    assert.equal(calls.length, 1);
  });
  for (const status of [404, 408, 429, 500, 503]) {
    await scenario('HTTP ' + status + ' fallback', body => {
      if (body.model === 'model-a') throw failure(status);
      return success();
    }, async (run, calls) => {
      assert.equal((await run()).model, 'model-b');
      assert.deepEqual(calls.map(c => c.model), status === 503 ? ['model-a', 'model-a', 'model-a', 'model-b'] : ['model-a', 'model-b']);
    });
  }
  await scenario('timeout fallback', body => {
    if (body.model === 'model-a') throw failure(undefined, 'ETIMEDOUT');
    return success();
  }, async run => assert.equal((await run()).model, 'model-b'));
  for (const status of [400, 401, 403]) {
    await scenario('HTTP ' + status + ' stops immediately', () => { throw failure(status); }, async (run, calls) => {
      await assert.rejects(run, new RegExp('AI_REQUEST_FAILED_' + status));
      assert.equal(calls.length, 1);
    });
  }
  await scenario('invalid output twice then fresh fallback input', body => body.model === 'model-a'
    ? { data: { choices: [{ finish_reason: 'stop', message: { content: '{"ok":false}' } }] } } : success(),
    async (run, calls) => {
      assert.equal((await run()).model, 'model-b');
      assert.deepEqual(calls.map(c => c.model), ['model-a', 'model-a', 'model-b']);
      assert.ok(calls[1].payload.validationFeedback);
      assert.equal(calls[2].payload.previousOutput, undefined);
      assert.equal(calls[2].payload.validationFeedback, undefined);
    });
  await scenario('all models exhausted without cycling', () => { throw failure(429); }, async (run, calls) => {
    await assert.rejects(run, /AI_REQUEST_FAILED_429/);
    assert.deepEqual(calls.map(c => c.model), ['model-a', 'model-b', 'model-c']);
  });
  await scenario('content filter stops without model fallback', () => ({ data: { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] } }), async (run, calls) => {
    await assert.rejects(run, /AI_CONTENT_BLOCKED/);
    assert.equal(calls.length, 1);
  });
  axios.post = async () => success();
  assert.deepEqual(await complete(schema, 'system', {}), { ok: true });
  passed.push('legacy complete return value');
  assert.ok(!logs.join('\n').includes(process.env.AI_API_KEY));
  assert.ok(logs.some(log => log.includes('ai_model_fallback')));
} finally {
  axios.post = originalPost;
  Object.assign(console, originalLog);
}
console.log(JSON.stringify({ testsPassed: passed.length, tests: passed, databaseUsed: false, providerRequests: 0 }, null, 2));
