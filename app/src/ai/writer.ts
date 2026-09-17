import { z } from 'zod';
import { completeWithModel } from './client.js';
import { chartPlanForWriter, presentation, inlineFacts, fillFacts, type PostPresentation } from './presentation.js';
import { draftSchema, type Decision, type DraftOutput } from './types.js';
import { writerPrompt, type WriterPromptType } from './prompts.js';
import { POST_MIN_CHARACTERS, POST_TARGET_CHARACTERS, POST_MAX_CHARACTERS } from './limits.js';
import { invalidated } from '../series/decision-engine.js';
import { assembleFormat, WRITING_FORMAT_IDS, WRITING_FORMATS, type WritingFormatId } from './writing-formats.js';
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
function assemblePost(p: DraftOutput['post'], facts: string, layout = 0): string {
  const scenarios = layout === 1 ? [p.bearishScenario, p.bullishScenario] : [p.bullishScenario, p.bearishScenario];
  const body = layout === 2 ? [p.hook, p.interpretation, p.risk, ...scenarios] : [p.hook, p.interpretation, ...scenarios, p.risk];
  return [p.title, ...body, p.tags.join(' ')].join('\n\n');
}
function resolveOutput(output: DraftOutput, facts: Record<string, string>): DraftOutput {
  const post = { ...output.post };
  for (const key of ['title', 'hook', 'interpretation', 'bullishScenario', 'bearishScenario', 'risk'] as const) post[key] = fillFacts(post[key], facts);
  return { post, series: { ...output.series, title: fillFacts(output.series.title, facts), newThesis: fillFacts(output.series.newThesis, facts), nextWatch: output.series.nextWatch.map(text => fillFacts(text, facts)) } };
}
export function assemble(output: DraftOutput, facts: string): string {
  if (output.post.format) return assembleFormat(output.post, output.post.format);
  return assemblePost(output.post, facts);
}

function selectWritingFormat(context: AgentContext, display: PostPresentation): WritingFormatId {
  const showsBothFrames = display.chartPlan.dashboard === 'timeframes'
    || (display.chartPlan.technicalTimeframes.includes('1h') && display.chartPlan.technicalTimeframes.includes('4h'));
  const eligible = WRITING_FORMAT_IDS.filter(format => format !== 'timeframe_lens'
    || (showsBothFrames && (display.style === 'price' || display.style === 'volume')));
  const recentFormats = context.recentPosts.filter(post => post.metadata.writerMode !== 'data_only')
    .slice(0, 3).flatMap(post => {
      const parsed = draftSchema.safeParse(post.metadata.output);
      return parsed.success && parsed.data.post.format ? [parsed.data.post.format] : [];
    });
  const fresh = eligible.filter(format => !recentFormats.includes(format));
  const choices = fresh.length ? fresh : eligible;
  const seed = Array.from(`${context.market.symbol}:${context.market.asOf}:writing-format`)
    .reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return choices[seed % choices.length]!;
}
const transitions: Record<string, string[]> = {
  WATCHING: ['WATCHING', 'BREAKOUT_ATTEMPT', 'BREAKOUT_CONFIRMED', 'INVALIDATED', 'CLOSED'],
  BREAKOUT_ATTEMPT: ['WATCHING', 'BREAKOUT_ATTEMPT', 'BREAKOUT_CONFIRMED', 'INVALIDATED', 'CLOSED'],
  BREAKOUT_CONFIRMED: ['BREAKOUT_CONFIRMED', 'RETEST', 'CONTINUATION', 'INVALIDATED', 'CLOSED'],
  RETEST: ['RETEST', 'CONTINUATION', 'INVALIDATED', 'CLOSED'],
  CONTINUATION: ['CONTINUATION', 'RETEST', 'INVALIDATED', 'CLOSED'],
};
export async function writeDraft(context: AgentContext, decision: Decision, display: PostPresentation = presentation(context)) {
  const values = inlineFacts(context);
  const format = selectWritingFormat(context, display);
  const render = (output: DraftOutput) => assembleFormat(resolveOutput(output, values).post, format);
  // Count fixed facts, labels and separators with the same assembler used to save the post.
  const fixedCharacters = Array.from(assembleFormat({ title: '', hook: '', interpretation: '', bullishScenario: '', bearishScenario: '', risk: '', tags: [] }, format)).length;
  const postTextBudget = {
    min: POST_MIN_CHARACTERS - fixedCharacters,
    target: POST_TARGET_CHARACTERS - fixedCharacters,
    max: POST_MAX_CHARACTERS - fixedCharacters,
  };
  const previous = context.activeSeries.find(s => s.id === decision.seriesId);
  const forcedInvalidation = previous ? invalidated(previous, context.market.frames['1h'].price) : false;
  const allowedLevels = [...Object.values(context.market.frames).flatMap(f => [...f.levels.support, ...f.levels.resistance]), ...[previous?.bull_trigger, previous?.bear_trigger, previous?.invalidation_price].filter((v): v is number => typeof v === 'number')];
  const schema = draftSchema.superRefine((output, ctx) => {
    const content = render(output), length = Array.from(content).length;
    const textFields: [string[], string][] = [
      ...Object.entries(output.post).filter((entry): entry is [string, string] => entry[0] !== 'format' && typeof entry[1] === 'string').map(([key, value]): [string[], string] => [['post', key], value]),
      [['series', 'title'], output.series.title], [['series', 'newThesis'], output.series.newThesis],
      ...output.series.nextWatch.map((text, i): [string[], string] => [['series', 'nextWatch', String(i)], text]),
    ];
    for (const [field, text] of textFields) {
      const resolved = fillFacts(text, values);
      if (/[{}]/.test(resolved)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: field, message: 'Unknown placeholder. Use only {{name}} from inlineFacts.' });
      if (/\d/.test(text.replace(/\{\{[a-z_]+\}\}/g, ''))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: field, message: 'Use inlineFacts placeholders for numbers and asset names; write timeframe/indicator names in words.' });
    }
    const resolvedSchema = draftSchema.safeParse(resolveOutput(output, values));
    if (!resolvedSchema.success) for (const issue of resolvedSchema.error.issues) ctx.addIssue(issue);
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
      derivatives: {
        funding: market.derivatives.funding, openInterest: market.derivatives.openInterest,
        oiChange1h: market.derivatives.oiChange1h, longShortRatio: market.derivatives.longShortRatio,
        oiRecent: market.derivatives.oiHistory?.slice(-4), longShortRecent: market.derivatives.longShortHistory?.slice(-4),
        unavailable: market.derivatives.unavailable,
      }, warnings: market.warnings,
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
    allowedLevels: [...new Set(allowedLevels)], postTextBudget, inlineFacts: values, editorialStyle: display.style,
    chartPlan: chartPlanForWriter(display.chartPlan),
    writingFormat: { id: format, name: WRITING_FORMATS[format].name },
    recentOpenings: context.recentPosts.filter(post => post.metadata.writerMode !== 'data_only').slice(0, 3).map(post => {
      const stored = draftSchema.safeParse(post.metadata.output);
      const characters = Array.from(post.content);
      return { title: post.title, opening: characters.slice(0, 260).join(''), ending: characters.slice(-200).join(''), format: stored.success ? stored.data.post.format ?? null : null };
    }),
  };
  const chartKey = [display.chartPlan.dashboard, ...display.chartPlan.technicalTimeframes].join(':');
  const { data: output, model } = await completeWithModel(schema, writerPrompt(promptType, display.style, format), input, `${promptType}:${display.style}:${chartKey}:${format}`);
  const resolved = resolveOutput(output, values);
  // Code owns the format; persist it inside the output already saved in post metadata.
  resolved.post.format = format;
  return { output: resolved, content: render(output), editorialStyle: display.style, aiModel: model };
}
