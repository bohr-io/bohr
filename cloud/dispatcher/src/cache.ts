interface Entry<V> {
  value: V;
  expires: number;
}

/**
 * Per-isolate memory cache with a TTL per entry. The size is bounded so random
 * hostnames or headers cannot grow it without limit; when full, the oldest
 * insertion is dropped.
 */
export class TtlCache<V> {
  readonly #entries = new Map<string, Entry<V>>();
  readonly #maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.#maxEntries = maxEntries;
  }

  /** Returns the cached value, or undefined when absent or expired. */
  get(key: string, now = Date.now()): V | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expires <= now) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number, now = Date.now()): void {
    // Re-inserting moves the key to the end of the eviction order.
    this.#entries.delete(key);
    if (this.#entries.size >= this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }
    this.#entries.set(key, { value, expires: now + ttlMs });
  }

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }
}
