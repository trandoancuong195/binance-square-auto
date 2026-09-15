import { scan } from './index.js';
import { pool } from '../db/client.js';
try { console.log(JSON.stringify(await scan(), null, 2)); }
catch { console.error('Scan failed; check configuration, database and Binance connectivity.'); process.exitCode = 1; }
finally { await pool.end(); }
