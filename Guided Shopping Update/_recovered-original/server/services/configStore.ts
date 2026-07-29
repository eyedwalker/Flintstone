/**
 * Tiny key/JSON-value store for admin configuration (tiles, pages, etc.).
 *
 * Postgres-first. If DATABASE_URL is set and reachable we persist into a
 * single auto-created `app_config` table. If the DB is unreachable we fall
 * back to a JSON file on disk (./data/admin-config.json by default). The
 * file path is overridable via ADMIN_CONFIG_PATH so it can be mounted as
 * a Docker volume to survive container rebuilds.
 *
 * Read/write contract:
 *   get(key) -> any | null
 *   put(key, value) -> void
 */
import fs from 'fs/promises';
import path from 'path';
import { getPool } from '../config/database';

const FILE_PATH = process.env.ADMIN_CONFIG_PATH || path.resolve(process.cwd(), 'data', 'admin-config.json');
const TABLE = 'app_config';

let dbReady: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!dbReady) {
    dbReady = (async () => {
      try {
        const p = getPool();
        await p.query(`
          CREATE TABLE IF NOT EXISTS ${TABLE} (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        return true;
      } catch (err: any) {
        console.warn(`[configStore] Postgres unavailable, using file fallback: ${err.message}`);
        return false;
      }
    })();
  }
  return dbReady;
}

async function readFile(): Promise<Record<string, any>> {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8');
    return JSON.parse(raw) as Record<string, any>;
  } catch (err: any) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeFile(data: Record<string, any>): Promise<void> {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export async function get(key: string): Promise<any | null> {
  if (await ensureTable()) {
    const p = getPool();
    const r = await p.query(`SELECT value FROM ${TABLE} WHERE key = $1`, [key]);
    return r.rows[0]?.value ?? null;
  }
  const data = await readFile();
  return data[key] ?? null;
}

export async function put(key: string, value: any): Promise<void> {
  if (await ensureTable()) {
    const p = getPool();
    await p.query(
      `INSERT INTO ${TABLE} (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)],
    );
    return;
  }
  const data = await readFile();
  data[key] = value;
  await writeFile(data);
}
