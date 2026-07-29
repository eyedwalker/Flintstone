/**
 * Postgres database connection (replaces previous mssql setup)
 * Uses pg connection pool. Same env vars as Timeline:
 *   DATABASE_URL (preferred), or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
 */

import pg from 'pg';
const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    pool = new Pool({ connectionString, max: 10 });
  } else {
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'Patientcare',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      max: 10,
    });
  }

  pool.on('error', (err: Error) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });

  return pool;
}

export async function getConnection(): Promise<pg.Pool> {
  const p = getPool();
  try {
    await p.query('SELECT 1');
  } catch (err: any) {
    console.error('[DB] Connection check failed:', err.message);
    throw err;
  }
  return p;
}

export async function closeConnection(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[DB] Postgres pool closed');
  }
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const p = getPool();
  const result = await p.query(text, params);
  return result.rows as T[];
}
