/**
 * Unified Cache Manager with TTL and LRU eviction
 * Used by artifact-preflight, file-boundary, frontend-detection, etc.
 */

export interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
  accessCount: number;
  lastAccessedAt: number;
}

export interface CacheOptions {
  /** Time-to-live in milliseconds (default: 5000 = 5 seconds) */
  ttl?: number;
  /** Maximum number of entries (default: 100) */
  maxSize?: number;
  /** Namespace for this cache instance */
  namespace?: string;
}

export class CacheManager<T = unknown> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly ttl: number;
  private readonly maxSize: number;
  private readonly namespace: string;

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl ?? 5000; // Default: 5 seconds
    this.maxSize = options.maxSize ?? 100;
    this.namespace = options.namespace ?? 'default';
  }

  /**
   * Get a value from cache. Returns null if not found or expired.
   */
  get(key: string): T | null {
    const fullKey = this.namespace + ':' + key;
    const entry = this.cache.get(fullKey);

    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      // Expired - remove and return null
      this.cache.delete(fullKey);
      return null;
    }

    // Update access metadata (LRU)
    entry.accessCount++;
    entry.lastAccessedAt = now;

    return entry.value;
  }

  /**
   * Set a value in cache with TTL.
   */
  set(key: string, value: T, customTtl?: number): void {
    const fullKey = this.namespace + ':' + key;
    const now = Date.now();
    const ttl = customTtl ?? this.ttl;

    // Evict if at capacity (LRU: remove least recently used)
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(fullKey, {
      value,
      createdAt: now,
      expiresAt: now + ttl,
      accessCount: 0,
      lastAccessedAt: now,
    });
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Delete a specific entry.
   */
  delete(key: string): boolean {
    const fullKey = this.namespace + ':' + key;
    return this.cache.delete(fullKey);
  }

  /**
   * Clear all entries in this namespace.
   */
  clear(): void {
    const prefix = this.namespace + ':';
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all expired entries (cleanup).
   */
  clearExpired(): number {
    const now = Date.now();
    let cleared = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Get cache statistics.
   */
  stats(): {
    size: number;
    maxSize: number;
    ttl: number;
    namespace: string;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
      namespace: this.namespace,
    };
  }

  /**
   * Evict the least recently used entry.
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

/**
 * Global cache instances for different purposes.
 */
export const caches = {
  /** Artifact preflight check results (5s TTL) */
  artifactPreflight: new CacheManager<{ passed: boolean; missing: string[]; existence: Record<string, boolean> }>({
    ttl: 5000,
    maxSize: 50,
    namespace: 'artifact-preflight',
  }),

  /** File boundary patterns (10s TTL, longer because contract changes are rare) */
  fileBoundary: new CacheManager<{ taskBoundaries: Map<string, string[]>; globalPatterns: string[] }>({
    ttl: 10000,
    maxSize: 30,
    namespace: 'file-boundary',
  }),

  /** Frontend detection results (30s TTL, even longer because package.json changes are rare) */
  frontendDetection: new CacheManager<boolean>({
    ttl: 30000,
    maxSize: 20,
    namespace: 'frontend-detection',
  }),

  /** LESSONS.md search results (60s TTL) */
  lessonsSearch: new CacheManager<{ hits: Array<{ entry: unknown; matchedKeywords: string[] }> }>({
    ttl: 60000,
    maxSize: 40,
    namespace: 'lessons-search',
  }),
};

/**
 * Periodic cleanup task (run every 30 seconds).
 */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startCacheCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    for (const cache of Object.values(caches)) {
      cache.clearExpired();
    }
  }, 30000);
}

export function stopCacheCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
