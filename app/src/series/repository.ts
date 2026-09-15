import { randomUUID } from 'node:crypto';
import { transaction } from '../db/client.js';
import { draftSchema, decisionSchema } from '../ai/types.js';
import type { Post, Series } from '../types.js';

export async function approvePost(id: string): Promise<Post> {
  return transaction(async client => {
    // Same lock order for every approval prevents racing new series and draft approvals.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crypto-agent-approval'))");
    const post = (await client.query<Post>('SELECT * FROM posts WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!post) throw new Error('POST_NOT_FOUND');
    if (post.status === 'APPROVED' || post.status === 'PUBLISHED') return post;
    if (post.status !== 'DRAFT') throw new Error('POST_NOT_DRAFT');
    if (post.metadata.writerMode === 'data_only') throw new Error('POST_CONTENT_PENDING');
    const newer = await client.query("SELECT id FROM posts WHERE symbol=$1 AND status IN ('APPROVED','PUBLISHED') AND created_at>$2 LIMIT 1", [post.symbol, post.created_at]);
    if (newer.rowCount) throw new Error('SERIES_CHANGED_REGENERATE_DRAFT');
    const output = draftSchema.parse(post.metadata.output), decision = decisionSchema.parse(post.metadata.decision);
    const s = output.series;
    const closed = ['INVALIDATED', 'CLOSED'].includes(s.stage);
    let seriesId: string;
    if (decision.decision === 'NEW_POST') {
      const active = await client.query("SELECT id FROM series WHERE symbol=$1 AND status='ACTIVE'", [post.symbol]);
      if (active.rowCount) throw new Error('SERIES_CHANGED_REGENERATE_DRAFT');
      const result = await client.query<{ id: string }>(`INSERT INTO series(symbol,slug,title,status,stage,thesis,bias,bull_trigger,bear_trigger,invalidation_price,next_watch,closed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $12 THEN now() ELSE NULL END) RETURNING id`,
      [post.symbol, `${post.symbol.toLowerCase()}-${randomUUID()}`, s.title, closed ? 'CLOSED' : 'ACTIVE', s.stage, s.newThesis, s.bias, s.bullTrigger, s.bearTrigger, s.invalidationPrice, JSON.stringify(s.nextWatch), closed]);
      seriesId = result.rows[0]!.id;
    } else {
      const current = (await client.query<Series>('SELECT * FROM series WHERE id=$1 FOR UPDATE', [decision.seriesId])).rows[0];
      if (!current || current.symbol !== post.symbol || current.status !== 'ACTIVE' || current.version !== post.metadata.seriesVersion) throw new Error('SERIES_CHANGED_REGENERATE_DRAFT');
      seriesId = current.id;
      await client.query(`UPDATE series SET title=$2,status=$3,stage=$4,thesis=$5,bias=$6,bull_trigger=$7,bear_trigger=$8,invalidation_price=$9,next_watch=$10,version=version+1,last_updated_at=now(),closed_at=CASE WHEN $11 THEN now() ELSE NULL END WHERE id=$1`,
        [seriesId, s.title, closed ? 'CLOSED' : 'ACTIVE', s.stage, s.newThesis, s.bias, s.bullTrigger, s.bearTrigger, s.invalidationPrice, JSON.stringify(s.nextWatch), closed]);
    }
    // Approval is an editorial action, never an assertion that the post is published.
    const updated = (await client.query<Post>("UPDATE posts SET status='APPROVED',series_id=$2,approved_at=now() WHERE id=$1 RETURNING *", [id, seriesId])).rows[0]!;
    await client.query("INSERT INTO agent_memory(symbol,memory_type,content,importance,metadata) VALUES($1,'THESIS',$2,$3,$4),($1,'POST_SUMMARY',$5,$3,$4),($1,'SERIES_UPDATE',$6,$3,$4)",
      [post.symbol, s.newThesis, decision.importance, JSON.stringify({ postId: id, seriesId, editorialStatus: 'APPROVED' }), output.post.interpretation, `${s.stage}: ${s.newThesis}`]);
    return updated;
  });
}
