import type { AgentContext } from '../types.js';
import type { DraftOutput } from './types.js';
import { POST_MIN_CHARACTERS, POST_MAX_CHARACTERS } from './limits.js';
function similarity(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toLocaleLowerCase('vi').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1));
  const first = tokens(a), second = tokens(b);
  const union = new Set([...first, ...second]);
  return union.size ? [...first].filter(w => second.has(w)).length / union.size : 0;
}
export function qualityGate(content: string, output: DraftOutput, context: AgentContext) {
  const length = Array.from(content).length;
  const duplicateSimilarity = Math.max(0, ...context.recentPosts.map(p => similarity(content, p.content)));
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (length < POST_MIN_CHARACTERS || length > POST_MAX_CHARACTERS) reasons.push('INVALID_POST_LENGTH');
  if (duplicateSimilarity > 0.85) warnings.push('SIMILAR_TO_RECENT_POST');
  if (/(đảm bảo|chắc chắn).{0,30}(lợi nhuận|tăng giá|thắng)|lợi nhuận.{0,15}đảm bảo/iu.test(content)) reasons.push('GUARANTEED_RETURN_CLAIM');
  const components = {
    marketSignificance: Math.round(context.market.trendScore / 100 * 25),
    technicalClarity: context.market.frames['1h'].levels.support.length && context.market.frames['1h'].levels.resistance.length ? 20 : 10,
    newInformation: Math.round((1 - duplicateSimilarity) * 20),
    seriesRelevance: context.activeSeries.length ? 15 : 10,
    writingQuality: length >= POST_MIN_CHARACTERS && length <= POST_MAX_CHARACTERS ? 10 : 0,
    riskDisclosure: output.post.risk.length >= 30 ? 5 : 0,
    chartQuality: 0,
  };
  return { passed: reasons.length === 0, reasons, warnings, length, duplicateSimilarity, components, score: Object.values(components).reduce((a, b) => a + b, 0), automaticPublishEligible: false };
}
