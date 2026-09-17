import { z } from 'zod';
import { WRITING_FORMAT_IDS } from './writing-formats.js';
export const actionSchema = z.enum(['NEW_POST', 'CONTINUE_SERIES', 'UPDATE_SERIES', 'SKIP']);
export const decisionSchema = z.object({
  decision: actionSchema,
  seriesId: z.string().regex(/^\d+$/).nullable(),
  reason: z.string().min(10).max(800),
  importance: z.number().min(0).max(1),
}).strict();
export type Decision = z.infer<typeof decisionSchema>;
const prose = z.string().min(30).max(600);
export const draftSchema = z.object({
  series: z.object({
    title: z.string().min(5).max(120),
    stage: z.enum(['WATCHING', 'BREAKOUT_ATTEMPT', 'BREAKOUT_CONFIRMED', 'RETEST', 'CONTINUATION', 'INVALIDATED', 'CLOSED']),
    bias: z.enum(['bullish', 'bearish', 'neutral']),
    newThesis: prose,
    bullTrigger: z.number().positive().nullable(),
    bearTrigger: z.number().positive().nullable(),
    invalidationPrice: z.number().positive().nullable(),
    nextWatch: z.array(z.string().min(5).max(200)).min(1).max(3),
  }).strict(),
  post: z.object({
    format: z.enum(WRITING_FORMAT_IDS).optional(),
    title: z.string().min(10).max(100),
    hook: prose,
    interpretation: prose,
    bullishScenario: prose,
    bearishScenario: prose,
    risk: prose,
    tags: z.array(z.string().regex(/^#[\p{L}A-Za-z0-9_]{2,30}$/u)).max(4),
  }).strict(),
}).strict();
export type DraftOutput = z.infer<typeof draftSchema>;
