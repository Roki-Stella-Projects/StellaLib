/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 */

/**
 * A memory-efficient LRU (Least Recently Used) cache with TTL support.
 * Evicts the oldest entries when maxSize is exceeded.
 */
export class LRUCache<K, V> {
	private readonly cache = new Map<K, { value: V; expiry: number }>();
	private readonly maxSize: number;
	private readonly ttl: number;

	/**
	 * @param maxSize Maximum number of entries (default: 200).
	 * @param ttl Time-to-live in ms (0 = no expiry, default: 0).
	 */
	constructor(maxSize = 200, ttl = 0) {
		this.maxSize = maxSize;
		this.ttl = ttl;
	}

	/** Number of entries in the cache. */
	public get size(): number {
		return this.cache.size;
	}

	/** Get a value by key. Returns undefined if not found or expired. */
	public get(key: K): V | undefined {
		const entry = this.cache.get(key);
		if (!entry) return undefined;

		// Check TTL expiry
		if (this.ttl > 0 && Date.now() > entry.expiry) {
			this.cache.delete(key);
			return undefined;
		}

		// Move to end (most recently used) by re-inserting
		this.cache.delete(key);
		this.cache.set(key, entry);
		return entry.value;
	}

	/** Check if a key exists and is not expired. */
	public has(key: K): boolean {
		return this.get(key) !== undefined;
	}

	/** Set a key-value pair. Evicts LRU entry if at capacity. */
	public set(key: K, value: V): void {
		// Delete first to reset position if already exists
		this.cache.delete(key);

		// Evict oldest entries if at capacity
		while (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) this.cache.delete(firstKey);
			else break;
		}

		this.cache.set(key, {
			value,
			expiry: this.ttl > 0 ? Date.now() + this.ttl : 0,
		});
	}

	/** Delete a key. */
	public delete(key: K): boolean {
		return this.cache.delete(key);
	}

	/** Clear all entries. */
	public clear(): void {
		this.cache.clear();
	}

	/** Prune all expired entries. Call periodically to free memory. */
	public prune(): number {
		if (this.ttl <= 0) return 0;
		const now = Date.now();
		let pruned = 0;
		for (const [key, entry] of this.cache) {
			if (now > entry.expiry) {
				this.cache.delete(key);
				pruned++;
			}
		}
		return pruned;
	}

	/** Get memory usage estimate in bytes (rough). */
	public get memoryEstimate(): number {
		// Rough estimate: 100 bytes overhead per Map entry + key/value sizes
		return this.cache.size * 100;
	}
}
