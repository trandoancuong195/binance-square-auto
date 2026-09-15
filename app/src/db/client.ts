import pg, { type PoolClient } from 'pg';
import { env } from '../config/env.js';
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000 });
pool.on('error', () => console.error(JSON.stringify({ event: 'database_pool_error' })));
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
