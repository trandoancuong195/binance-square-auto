import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

export const appRoot = fileURLToPath(new URL('../../', import.meta.url));
dotenv.config({ path: path.join(appRoot, '.env') });
const positive = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'), PORT: positive(3100),
  DATABASE_URL: z.string().url(), INTERNAL_API_KEY: z.string().min(24),
  DB_CONTEXT_ENABLED: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  BINANCE_BASE_URL: z.string().url().default('https://api.binance.com'),
  BINANCE_FUTURES_URL: z.string().url().default('https://fapi.binance.com'),
  ENABLE_FUTURES: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  AI_WRITER_ENABLED: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  AI_BASE_URL: z.union([z.string().url(), z.literal('')]).default(''),
  AI_API_KEY: z.string().default(''), AI_MODEL: z.string().default(''),
  AI_FALLBACK_MODELS: z.string().default('').transform(v => [...new Set(v.split(',').map(m => m.trim()).filter(Boolean))]).pipe(z.array(z.string().regex(/^[A-Za-z0-9_./:-]{1,120}$/)).max(4)),
  AI_TIMEOUT_MS: positive(60000),
  MIN_TREND_SCORE: z.coerce.number().min(0).max(100).default(75),
  MIN_QUOTE_VOLUME: positive(10000000),
  SCANNER_SHORTLIST: positive(20).refine(v => v <= 50),
  TRENDING_SYMBOL_COOLDOWN_HOURS: z.coerce.number().int().min(0).max(168).default(12),
  TRENDING_MAX_CANDIDATE_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  SNAPSHOT_MAX_AGE_MINUTES: positive(15),
  OUTPUT_DIR: z.string().default('output'), PUPPETEER_EXECUTABLE_PATH: z.string().default(''),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) throw new Error(`Invalid environment fields: ${parsed.error.issues.map(i => i.path.join('.')).join(', ')}`);
export const env = parsed.data;
export const outputRoot = path.resolve(appRoot, env.OUTPUT_DIR);
