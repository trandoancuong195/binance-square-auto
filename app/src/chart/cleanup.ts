import { lstat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { outputRoot } from '../config/env.js';
import { transaction } from '../db/client.js';
import type { Post } from '../types.js';

const missing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

// Only accept the renderer's exact file layout for this post, never caller-supplied paths.
async function chartFile(root: string, relative: string, post: Post): Promise<string | null> {
  const parts = relative.split('/');
  if (parts.length !== 4 || parts[0] !== post.symbol || !/^[A-Z0-9]+$/.test(parts[0]!)
    || !/^\d{4}-\d{2}-\d{2}$/.test(parts[1]!) || parts[2] !== post.snapshot_id
    || !/^\d+$/.test(parts[2]!) || !/^(1h|4h|dashboard)\.png$/.test(parts[3]!)) throw new Error('INVALID_CHART_PATH');
  const file = path.resolve(root, ...parts);
  const relativeToRoot = path.relative(root, file);
  if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) throw new Error('INVALID_CHART_PATH');
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) throw new Error('INVALID_CHART_PATH');
    } catch (error) { if (missing(error)) return null; throw error; }
  }
  return file;
}

export async function deletePostCharts(postId: string) {
  return transaction(async client => {
    const post = (await client.query<Post>('SELECT * FROM posts WHERE id=$1 FOR UPDATE', [postId])).rows[0];
    if (!post) throw new Error('POST_NOT_FOUND');
    if (post.chart_paths.length === 0) return { postId, deleted: 0, alreadyMissing: 0, chart_paths: [], alreadyCleaned: true };
    let root: string;
    try { root = await realpath(outputRoot); }
    catch (error) { if (!missing(error)) throw new Error('CHART_DELETE_FAILED'); root = path.resolve(outputRoot); }
    const files: (string | null)[] = [];
    try {
      // Validate every target before removing the first file; never recurse or remove directories.
      for (const relative of new Set(post.chart_paths)) files.push(await chartFile(root, relative, post));
      let deleted = 0, alreadyMissing = 0;
      for (const file of files) {
        if (file === null) { alreadyMissing++; continue; }
        try { await unlink(file); deleted++; }
        catch (error) { if (missing(error)) alreadyMissing++; else throw error; }
      }
      await client.query(`UPDATE posts SET chart_paths='[]'::jsonb,
        metadata=metadata || jsonb_build_object('chartsDeletedAt', now()) WHERE id=$1`, [postId]);
      return { postId, deleted, alreadyMissing, chart_paths: [], alreadyCleaned: false };
    } catch (error) {
      // Filesystem changes cannot roll back; keep stored paths on failure so retry can finish.
      if (error instanceof Error && error.message === 'INVALID_CHART_PATH') throw error;
      throw new Error('CHART_DELETE_FAILED');
    }
  });
}
