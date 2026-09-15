import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { draftSchema } from './types.js';

function requestFailure(error: unknown): Error {
  if (!axios.isAxiosError(error)) return new Error('AI_REQUEST_FAILED');
  const status = error.response?.status;
  const transportCodes = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ERR_NETWORK', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT']);
  const transport = error.code && transportCodes.has(error.code) ? error.code : 'NETWORK';
  const provider = z.object({ error: z.object({ status: z.enum(['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'NOT_FOUND', 'RESOURCE_EXHAUSTED', 'UNAUTHENTICATED', 'FAILED_PRECONDITION', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED', 'OUT_OF_RANGE', 'CANCELLED', 'UNKNOWN']) }) }).safeParse(error.response?.data);
  const providerStatus = provider.success ? provider.data.error.status : undefined;
  const code = `AI_REQUEST_FAILED_${status ?? transport}${providerStatus ? `_${providerStatus}` : ''}`;
  const hints: Record<number, string> = {
    400: 'Provider rejected the request. Check supported parameters and model requirements.',
    401: 'Provider authentication failed. Check AI_API_KEY.',
    403: 'Provider denied access. Check API key restrictions, project permissions and service availability.',
    404: 'Endpoint or model was not found. Check AI_BASE_URL and AI_MODEL.',
    429: 'Provider rate limit or quota reached. Check project quota and billing, then retry later.',
    502: 'AI endpoint or gateway returned an invalid upstream response after bounded retries.',
    503: 'AI endpoint is temporarily unavailable after bounded retries. Try again later and check provider availability.',
    504: 'AI endpoint or gateway timed out waiting for its upstream after bounded retries.',
  };
  // Axios errors include Authorization headers and request bodies. Never log them or raw provider responses.
  console.error(JSON.stringify({
    event: 'ai_request_failed', code, http_status: status ?? null,
    provider_status: providerStatus ?? null,
    hint: status ? hints[status] ?? 'Provider returned an HTTP error.' : 'Check outbound connectivity, DNS, TLS and AI_TIMEOUT_MS.',
  }));
  return new Error(code);
}

async function withTransientRetry<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await request(); }
    catch (error) {
      if (!axios.isAxiosError(error) || ![502, 503, 504].includes(error.response?.status ?? 0) || attempt === 2) throw error;
      const header = error.response?.headers['retry-after'];
      let retryAfterMs = 0;
      if (typeof header === 'string' || typeof header === 'number') {
        const seconds = Number(header);
        retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(header)) - Date.now();
        if (!Number.isFinite(retryAfterMs)) retryAfterMs = 0;
      }
      // Do not retry earlier than requested, or hold this request for a long Retry-After.
      if (retryAfterMs > 30000) throw error;
      const delayMs = Math.max(1000 * 2 ** attempt + Math.floor(Math.random() * 250), retryAfterMs);
      console.warn(JSON.stringify({ event: 'ai_request_retry', http_status: error.response?.status, retry: attempt + 1, delay_ms: delayMs }));
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('AI_REQUEST_FAILED');
}

function validationIssues(error: z.ZodError, writer = false) {
  return error.issues.slice(0, 20).map(issue => {
    // Enum/literal errors and unknown-key messages may embed provider-generated text.
    let message: string;
    switch (issue.code) {
      case 'invalid_enum_value': message = 'Value is not an allowed enum option.'; break;
      case 'invalid_literal': message = 'Value does not match the required literal.'; break;
      case 'unrecognized_keys': {
        const objectPath = issue.path.join('.');
        const shape = writer ? objectPath === 'series' ? draftSchema.shape.series.shape
          : objectPath === 'post' ? draftSchema.shape.post.shape
          : objectPath === '' ? draftSchema.shape : undefined : undefined;
        message = shape ? `Remove extra fields. This object must contain only: ${Object.keys(shape).join(', ')}. Put no explanations or input fields here.`
          : 'Remove extra fields; keep only the keys in the required JSON schema.';
        break;
      }
      case 'invalid_union': message = 'Value does not match any allowed type.'; break;
      default: message = issue.message;
    }
    for (const secret of [env.AI_API_KEY, env.INTERNAL_API_KEY]) if (secret) message = message.split(secret).join('[REDACTED]');
    return { path: issue.path.join('.') || '$', code: issue.code, message: message.slice(0, 500) };
  });
}

export async function complete<T>(schema: z.ZodType<T>, system: string, input: unknown, promptType?: string): Promise<T> {
  if (!env.AI_BASE_URL || !env.AI_API_KEY || !env.AI_MODEL) throw new Error('AI_NOT_CONFIGURED');
  const callId = randomUUID();
  let feedback = '';
  let previousOutput: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const userContent = JSON.stringify({ input, ...(feedback ? { validationFeedback: feedback, previousOutput } : {}) });
    let responseData: unknown;
    try {
      const response = await withTransientRetry(() => axios.post<unknown>(`${env.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        model: env.AI_MODEL, temperature: 0.3, max_tokens: 2400,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
      }, { headers: { Authorization: `Bearer ${env.AI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: env.AI_TIMEOUT_MS, maxRedirects: 0, maxContentLength: 1000000 }));
      responseData = response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) throw requestFailure(error);
      throw error;
    }
    const envelope = z.object({
      choices: z.array(z.object({ finish_reason: z.unknown().optional(), message: z.object({ content: z.unknown().optional() }) })).min(1),
      usage: z.unknown().optional(),
    }).safeParse(responseData);
    if (!envelope.success) {
      console.warn(JSON.stringify({ event: 'ai_output_invalid', call_id: callId, attempt: attempt + 1, stage: 'response_envelope', issue_count: envelope.error.issues.length, issues: validationIssues(envelope.error) }));
      feedback = 'Return a valid JSON object with the exact required schema.';
      continue;
    }
    const choice = envelope.data.choices[0]!;
    const finishReason = z.enum(['stop', 'length', 'tool_calls', 'content_filter', 'function_call']).safeParse(choice.finish_reason);
    const usage = z.object({ prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional(), completion_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative().optional() }).optional() }).safeParse(envelope.data.usage);
    const content = choice.message.content;
    const metadata = {
      call_id: callId, attempt: attempt + 1,
      prompt_type: promptType ?? null,
      request_characters: Array.from(system).length + Array.from(userContent).length,
      prompt_tokens: usage.success ? usage.data.prompt_tokens ?? null : null,
      finish_reason: finishReason.success ? finishReason.data : choice.finish_reason == null ? null : 'other',
      content_characters: typeof content === 'string' ? Array.from(content).length : null,
      completion_tokens: usage.success ? usage.data.completion_tokens ?? null : null,
      reasoning_tokens: usage.success ? usage.data.completion_tokens_details?.reasoning_tokens ?? null : null,
      max_tokens: 2400,
    };
    console.info(JSON.stringify({ event: 'ai_response_received', ...metadata }));
    if (typeof content !== 'string' || !content.trim()) {
      console.warn(JSON.stringify({ event: 'ai_output_invalid', ...metadata, stage: 'content', reason: 'EMPTY_OR_NON_STRING_CONTENT' }));
      feedback = 'Return a non-empty JSON object in message content with the exact required schema.';
      continue;
    }
    let data: unknown;
    try { data = JSON.parse(content); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      // JSON.parse messages can contain response excerpts; report a fixed reason instead.
      console.warn(JSON.stringify({ event: 'ai_output_invalid', ...metadata, stage: 'json_parse', reason: 'INVALID_JSON', hint: metadata.finish_reason === 'length' ? 'Provider reported the token limit; the JSON may be truncated.' : 'Expected a JSON object without Markdown fences or surrounding prose.' }));
      feedback = 'Return a valid JSON object with the exact required schema, without Markdown fences or surrounding prose.';
      continue;
    }
    const parsed = schema.safeParse(data);
    if (parsed.success) return parsed.data;
    const issues = validationIssues(parsed.error, promptType !== undefined);
    console.warn(JSON.stringify({ event: 'ai_output_invalid', ...metadata, stage: 'schema_validation', issue_count: parsed.error.issues.length, issues }));
    // Send the rejected draft back for correction, without logging its contents.
    previousOutput = content.length <= 16000 ? data : undefined;
    // Group repeated prose errors so later price/schema corrections are not crowded out.
    const grouped = new Map<string, string[]>();
    for (const issue of issues) {
      const paths = grouped.get(issue.message) ?? [];
      paths.push(issue.path);
      grouped.set(issue.message, paths);
    }
    feedback = [...grouped].map(([message, paths]) => `${paths.join(', ')}: ${message}`).join('; ').slice(0, 2000);
  }
  console.error(JSON.stringify({ event: 'ai_output_exhausted', call_id: callId, attempts: 2, code: 'AI_OUTPUT_INVALID' }));
  throw new Error('AI_OUTPUT_INVALID');
}
