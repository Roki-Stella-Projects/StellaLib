/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 */
import type { SessionStore } from "./Types";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * File-based session store that persists Lavalink session IDs to disk.
 * This allows session resume after bot restarts — players keep playing seamlessly.
 *
 * Usage:
 * ```ts
 * const manager = new StellaManager({
 *   sessionStore: new FileSessionStore("./sessions.json"),
 *   // ...
 * });
 * ```
 */
export class FileSessionStore implements SessionStore {
	private data: Record<string, string> = {};
	private dirty = false;
	private writeTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * @param filePath Path to the JSON file for storing sessions.
	 * @param flushInterval How often to write to disk in ms (default: 1000). Set to 0 for immediate writes.
	 */
	constructor(
		private readonly filePath: string,
		private readonly flushInterval = 1000,
	) {
		this.load();
	}

	/** Load sessions from disk. */
	private load(): void {
		try {
			if (existsSync(this.filePath)) {
				const raw = readFileSync(this.filePath, "utf-8");
				this.data = JSON.parse(raw);
			}
		} catch {
			this.data = {};
		}
	}

	/** Schedule a write to disk (debounced). */
	private scheduleFlush(): void {
		if (this.flushInterval === 0) {
			this.flush();
			return;
		}
		if (this.writeTimer) return;
		this.dirty = true;
		this.writeTimer = setTimeout(() => {
			this.flush();
			this.writeTimer = null;
		}, this.flushInterval);
	}

	/** Write sessions to disk immediately. */
	public flush(): void {
		try {
			const dir = dirname(this.filePath);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
			this.dirty = false;
		} catch {
			// Silently fail — best effort persistence
		}
	}

	public get(nodeId: string): string | null {
		return this.data[nodeId] ?? null;
	}

	public set(nodeId: string, sessionId: string): void {
		this.data[nodeId] = sessionId;
		this.scheduleFlush();
	}

	public delete(nodeId: string): void {
		delete this.data[nodeId];
		this.scheduleFlush();
	}

	/** Flush and clean up timers. Call on shutdown. */
	public destroy(): void {
		if (this.writeTimer) {
			clearTimeout(this.writeTimer);
			this.writeTimer = null;
		}
		if (this.dirty) this.flush();
	}
}
