/**
 * Simple in-memory cache with TTL for service-level caching.
 * Reduces redundant API calls when navigating between pages.
 */
export class ServiceCache {
  private cache = new Map<string, { data: unknown; expiresAt: number }>();

  constructor(private defaultTtlMs = 30_000) {}

  /**
   * Get a cached value or fetch it. If the cache is fresh, returns immediately.
   * Otherwise calls the fetcher, caches the result, and returns it.
   */
  async get<T>(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T> {
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.data as T;
    }

    const data = await fetcher();
    this.cache.set(key, { data, expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs) });
    return data;
  }

  /** Invalidate a specific cache entry */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /** Invalidate all entries matching a prefix */
  invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  /** Clear all cached entries */
  clear(): void {
    this.cache.clear();
  }
}
