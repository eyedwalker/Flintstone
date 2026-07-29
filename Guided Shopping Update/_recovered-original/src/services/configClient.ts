/**
 * Thin fetch wrapper around the server's /api/admin-config/:key endpoint.
 *
 * Reads return the latest server value (or null if nothing's been saved).
 * Writes are fire-and-forget — we await them so callers can show errors,
 * but the existing services keep their sync API by writing localStorage
 * synchronously and pushing to the server in the background.
 */

const BASE = '/api/admin-config';

export async function fetchRemote<T>(key: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}/${key}`);
    if (!r.ok) return null;
    const body = await r.json();
    return (body?.value as T) ?? null;
  } catch (err) {
    console.warn(`[configClient] fetch ${key} failed`, err);
    return null;
  }
}

export async function pushRemote(key: string, value: any): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    return r.ok;
  } catch (err) {
    console.warn(`[configClient] push ${key} failed`, err);
    return false;
  }
}
