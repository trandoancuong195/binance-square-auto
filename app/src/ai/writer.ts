import { z } from 'zod';
import { complete } from './client.js';
import { draftSchema, type Decision, type DraftOutput } from './types.js';
import { writerPrompt, type WriterPromptType } from './prompts.js';
import { POST_MIN_CHARACTERS, POST_TARGET_CHARACTERS, POST_MAX_CHARACTERS } from './limits.js';
import { invalidated } from '../series/decision-engine.js';
import type { AgentContext } from '../types.js';

export const numberText = (n: number) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7, useGrouping: false }).format(n);
export function fixedFacts(context: AgentContext): string {
  const m = context.market, f = m.frames['1h'], d = m.derivatives;
  return [
    `${m.symbol} | ${m.asOf.slice(0, 16).replace('T', ' ')} UTC`,
    `Giá: ${numberText(m.price)} USDT | 24h: ${m.change24h.toFixed(2)}%`,
    `Nến đóng 1h: ${numberText(f.price)} | RSI: ${f.technical.rsi.toFixed(1)} | Volume: ${f.volume.ratio.toFixed(2)}x`,
    `EMA 20/50/200: ${[f.technical.ema20, f.technical.ema50, f.technical.ema200].map(numberText).join(' / ')}`,
    `Hỗ trợ: ${f.levels.support.slice(0, 2).map(numberText).join(' / ') || 'chưa xác định'} | Kháng cự: ${f.levels.resistance.slice(0, 2).map(numberText).join(' / ') || 'chưa xác định'}`,
    `Funding: ${d.funding === null ? 'thiếu dữ liệu' : (d.funding * 100).toFixed(4) + '%'} | OI 1h: ${d.oiChange1h === null ? 'thiếu dữ liệu' : d.oiChange1h.toFixed(2) + '%'}`,
  ].join('\n');
}
function assemblePost(p: DraftOutput['post'], facts: string): string {
  return [p.title, p.hook, facts, `Nhận định: ${p.interpretation}`, `Kịch bản tăng: ${p.bullishScenario}`, `Kịch bản giảm: ${p.bearishScenario}`, `Rủi ro: ${p.risk}`, p.tags.join(' ')].join('\n\n');
}
export function assemble(output: DraftOutput, facts: string): string {
  return assemblePost(output.post, facts);
}
const transitions: Record<string, string[]> = {
  WATCHING: ['WATCHING', 'BREAKOUT_ATTEMPT', 'BREAKOUT_CONFIRMED', 'INVALIDATED', 'CLOSED'],
  BREAKOUT_ATTEMPT: ['WATCHING', 'BREAKOUT_ATTEMPT', 'BREAKOUT_CONFIRMED', 'INVALIDATED', 'CLOSED'],
  BREAKOUT_CONFIRMED: ['BREAKOUT_CONFIRMED', 'RETEST', 'CONTINUATION', 'INVALIDATED', 'CLOSED'],
  RETEST: ['RETEST', 'CONTINUATION', 'INVALIDATED', 'CLOSED'],
  CONTINUATION: ['CONTINUATION', 'RETEST', 'INVALIDATED', 'CLOSED'],
};
export async function writeDraft(context: AgentContext, decision: Decision) {
  const facts = fixedFacts(context);
  // Count fixed facts, labels and separators with the same assembler used to save the post.
  const fixedCharacters = Array.from(assemblePost({ title: '', hook: '', interpretation: '', bullishScenario: '', bearishScenario: '', risk: '', tags: [] }, facts)).length;
  const postTextBudget = {
    min: POST_MIN_CHARACTERS - fixedCharacters,
    target: POST_TARGET_CHARACTERS - fixedCharacters,
    max: POST_MAX_CHARACTERS - fixedCharacters,
  };
  const previous = context.activeSeries.find(s => s.id === decision.seriesId);
  const forcedInvalidation = previous ? invalidated(previous, context.market.frames['1h'].price) : false;
  const allowedLevels = [...Object.values(context.market.frames).flatMap(f => [...f.levels.support, ...f.levels.resistance]), ...[previous?.bull_trigger, previous?.bear_trigger, previous?.invalidation_price].filter((v): v is number => typeof v === 'number')];
  const schema = draftSchema.superRefine((output, ctx) => {
    const content = assemble(output, facts), length = Array.from(content).length;
    const error = (path: string[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (length < POST_MIN_CHARACTERS || length > POST_MAX_CHARACTERS) {
      const correction = length > POST_TARGET_CHARACTERS ? `Shorten post text by about ${length - POST_TARGET_CHARACTERS} characters` : `Expand post text by about ${POST_TARGET_CHARACTERS - length} characters`;
      error(['post'], `Final assembled post is ${length} characters; must be ${POST_MIN_CHARACTERS}-${POST_MAX_CHARACTERS}. ${correction} to target ${POST_TARGET_CHARACTERS}. Fixed facts/labels use ${fixedCharacters}; your post fields and joined tags should total about ${postTextBudget.target} characters. Editing series fields does not change post length.`);
    }
    for (const field of ['bullTrigger', 'bearTrigger', 'invalidationPrice'] as const) {
      const value = output.series[field];
      if (value !== null && !allowedLevels.includes(value)) error(['series', field], 'All trigger prices must exactly match allowedLevels.');
    }
    const s = output.series;
    if (!['INVALIDATED', 'CLOSED'].includes(s.stage) && s.invalidationPrice !== null && (s.bias === 'neutral' || (s.bias === 'bullish' && s.invalidationPrice >= context.market.price) || (s.bias === 'bearish' && s.invalidationPrice <= context.market.price))) {
      const candidates = [...new Set(allowedLevels)].filter(level => s.bias === 'bullish' ? level < context.market.price : s.bias === 'bearish' ? level > context.market.price : false).slice(0, 6);
      const correction = s.bias === 'neutral' ? 'Set series.invalidationPrice to null.'
        : `Choose an allowedLevels value strictly ${s.bias === 'bullish' ? 'below' : 'above'} market.price=${context.market.price}, e.g. ${JSON.stringify(candidates)}, or null if no justified level exists.`;
      error(['series', 'invalidationPrice'], `Invalidation level is inconsistent with bias=${s.bias}. ${correction} Keep the bias and do not add explanation fields.`);
    }
    if (forcedInvalidation && s.stage !== 'INVALIDATED') error(['series', 'stage'], 'The thesis has been invalidated; stage must be INVALIDATED.');
    if (forcedInvalidation && s.invalidationPrice !== previous?.invalidation_price) error(['series', 'invalidationPrice'], 'Preserve the previous invalidation price as evidence when closing the invalidated thesis.');
    if (previous && s.bias !== previous.bias) error(['series', 'bias'], 'Do not silently change the existing series bias.');
    if (previous && !transitions[previous.stage]?.includes(s.stage)) error(['series', 'stage'], 'Invalid series stage transition.');
    if (!previous && !['WATCHING', 'BREAKOUT_ATTEMPT', 'BREAKOUT_CONFIRMED'].includes(s.stage)) error(['series', 'stage'], 'A new series must start at a watching or breakout stage.');
    const confirmed = s.bias === 'bearish' ? context.market.frames['1h'].supportBroken : context.market.frames['1h'].breakout;
    if (s.stage === 'BREAKOUT_CONFIRMED' && !confirmed && previous?.stage !== 'BREAKOUT_CONFIRMED') error(['series', 'stage'], 'No confirmed breakout evidence in the closed hourly candle for the selected bias.');
  });
  const promptType: WriterPromptType = forcedInvalidation ? 'INVALIDATED' : !previous ? 'NEW_POST' : decision.decision === 'UPDATE_SERIES' ? 'UPDATE_SERIES' : 'CONTINUE_SERIES';
  const market = context.market;
  // Keep the full context for validation; send only writing evidence to the model.
  const input = {
    market: {
      symbol: market.symbol, asOf: market.asOf, price: market.price, change24h: market.change24h,
      frames: Object.fromEntries(Object.entries(market.frames).map(([timeframe, frame]) => [timeframe, {
        price: frame.price, trend: frame.trend, change: frame.change,
        technical: timeframe === '1h' ? frame.technical : { rsi: frame.technical.rsi },
        volumeRatio: frame.volume.ratio, levels: frame.levels,
        breakout: frame.breakout, supportBroken: frame.supportBroken,
      }])),
      derivatives: market.derivatives, warnings: market.warnings,
    },
    previousSeries: previous ? {
      title: previous.title, stage: previous.stage, bias: previous.bias, thesis: previous.thesis,
      bullTrigger: previous.bull_trigger, bearTrigger: previous.bear_trigger,
      invalidationPrice: previous.invalidation_price, nextWatch: previous.next_watch,
    } : null,
    history: context.recentPosts.filter(post => post.metadata.writerMode !== 'data_only')
      .filter(post => !previous || post.series_id === previous.id).slice(0, 2).map(post => {
        const stored = draftSchema.safeParse(post.metadata.output);
        const excerpt = stored.success ? stored.data.post.interpretation : post.content;
        return {
          title: post.title, status: post.status, createdAt: post.created_at,
          excerpt: Array.from(excerpt).slice(0, 400).join(''),
        };
      }),
    allowedStages: forcedInvalidation ? ['INVALIDATED'] : previous ? transitions[previous.stage] ?? [] : ['WATCHING', 'BREAKOUT_ATTEMPT', 'BREAKOUT_CONFIRMED'],
    allowedLevels: [...new Set(allowedLevels)], postTextBudget,
  };
  const output = await complete(schema, writerPrompt(promptType), input, promptType);
  return { output, content: assemble(output, facts) };
}
