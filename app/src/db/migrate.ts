import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { appRoot } from '../config/env.js';
import { pool, transaction } from './client.js';
let stage = 'read_schema';
try {
  const sql = await readFile(path.join(appRoot, 'src/db/schema.sql'), 'utf8');
  stage = 'connect_database';
  await transaction(async client => {
    stage = 'initialize_migrations';
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crypto-agent-migration'))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', ['001_initial']);
    if (!exists.rowCount) {
      stage = 'apply_schema';
      await client.query(sql);
      stage = 'record_migration';
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', ['001_initial']);
    }
    stage = 'commit_transaction';
  });
  console.log('Database migration complete');
} catch (error) {
  const causes: unknown[] = error instanceof AggregateError ? error.errors : [error];
  const codes = [...new Set(causes.map(cause => {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(cause.code)) return cause.code;
    if (cause instanceof Error && /timeout|timed out/i.test(cause.message)) return 'CONNECTION_TIMEOUT';
    return 'UNKNOWN_ERROR';
  }))];
  const hints: Record<string, string> = {
    ECONNREFUSED: 'PostgreSQL is not listening at the configured host/port. Native PostgreSQL usually uses 5432; Docker mapping uses 5433.',
    '28P01': 'Database password authentication failed. Check DATABASE_URL credentials and URL encoding.',
    '28000': 'Database authentication was rejected. Check the database role and pg_hba.conf.',
    '3D000': 'Configured database does not exist.',
    '42501': 'Database role lacks permission to create or access the migration objects.',
    ENOTFOUND: 'Database hostname could not be resolved.',
    EAI_AGAIN: 'Database hostname resolution temporarily failed.',
    CONNECTION_TIMEOUT: 'Database connection timed out. Check the server, address and network access.',
    ENOENT: 'Migration schema file is missing. Upload app/src/db/schema.sql.',
  };
  // Never log the raw error, connection URL or credentials.
  console.error(JSON.stringify({ event: 'migration_failed', stage, codes, hints: codes.map(code => hints[code] ?? 'Inspect PostgreSQL server logs for details.') }, null, 2));
  process.exitCode = 1;
}
finally { await pool.end(); }
