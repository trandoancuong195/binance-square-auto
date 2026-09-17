import { pool } from './db/client.js';
import type { Post } from './types.js';

// Both candidate selection and HTTP delivery must accept the same stored payload.
export async function loadTrendingPost(postId: string): Promise<Post | null> {
  const post = (await pool.query<Post>(
    `SELECT * FROM posts WHERE id=$1
      AND status IN ('DRAFT','APPROVED') AND square_post_id IS NULL
      AND metadata->>'writerMode' = 'ai'
      AND metadata->'quality'->>'passed' = 'true'`, [postId],
  )).rows[0];
  if (!post || !post.content.trim() || !Array.isArray(post.chart_paths)
    || post.chart_paths.length < 1 || post.chart_paths.length > 3
    || post.chart_paths.some(chart => typeof chart !== 'string' || !chart.trim())
    || new Set(post.chart_paths).size !== post.chart_paths.length) return null;
  return post;
}
