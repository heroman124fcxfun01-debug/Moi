/**
 * Invisible In-Memory RAM Cache Engine (Desktop-class LRU cache for instant tab switches,
 * zero-latency pagination, and hot IndexedDB read-through caching).
 * Automatically trims low-priority entries when the app is backgrounded on mobile.
 */

export class RamLruCache<V> {
  private readonly maxEntries: number;
  private readonly map = new Map<string, V>();

  constructor(maxEntries = 120) {
    this.maxEntries = Math.max(8, maxEntries);
  }

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Promote to most-recently-used position
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  deleteByPrefix(prefix: string): number {
    let removed = 0;
    for (const key of Array.from(this.map.keys())) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  trimTo(limit: number): void {
    const safeLimit = Math.max(0, limit);
    while (this.map.size > safeLimit) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// Hot in-memory RAM caches (never exposed in UI)
export const storageRamCache = new RamLruCache<unknown>(32);
export const chapterPaginationRamCache = new RamLruCache<unknown>(80);
export const bookPaginationRamCache = new RamLruCache<unknown>(24);
export const renderedParagraphsRamCache = new RamLruCache<unknown>(60);

let lifecycleHookAttached = false;

/**
 * Registers a silent background-trim listener so mobile devices never hold excess
 * pagination caches while backgrounded, while keeping active sessions 100% hot in RAM.
 */
export function ensureRamCacheLifecycle(): void {
  if (lifecycleHookAttached || typeof document === 'undefined') return;
  lifecycleHookAttached = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      chapterPaginationRamCache.trimTo(24);
      bookPaginationRamCache.trimTo(8);
      renderedParagraphsRamCache.trimTo(20);
    }
  });
}

/**
 * Runs a low-priority warm-up callback during browser idle time without blocking animations.
 */
export function scheduleIdleWarmup(task: () => void, timeoutMs = 900): () => void {
  if (typeof window === 'undefined') return () => {};
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof win.requestIdleCallback === 'function') {
    const id = win.requestIdleCallback(task, { timeout: timeoutMs });
    return () => {
      win.cancelIdleCallback?.(id);
    };
  }
  const timer = window.setTimeout(task, 180);
  return () => window.clearTimeout(timer);
}
