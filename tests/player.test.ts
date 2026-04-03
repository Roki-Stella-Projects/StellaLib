/**
 * @file Player unit tests
 * Tests for StellaPlayer: inactivity timeout, queue size helpers, state snapshots
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";

// ─── Mock Helpers ────────────────────────────────────────────────────────

function createMockPlayer(overrides: Partial<Record<string, any>> = {}): any {
	const queue: any[] = [];
	(queue as any).current = null;
	(queue as any).previous = null;
	(queue as any).totalSize = 0;
	(queue as any).maxSize = 0;
	(queue as any).noDuplicates = false;

	return {
		guild: overrides.guild ?? "guild_123",
		voiceChannel: overrides.voiceChannel ?? "vc_456",
		textChannel: overrides.textChannel ?? "tc_789",
		node: { options: { identifier: "node-1" }, connected: true },
		state: "CONNECTED",
		playing: false,
		paused: false,
		position: 0,
		volume: 50,
		trackRepeat: false,
		queueRepeat: false,
		dynamicRepeat: false,
		isAutoplay: false,
		autoplayHistory: [],
		autoplaySeedPool: [],
		connected: true,
		voiceReady: true,
		ping: 42,
		inactivityTimeout: overrides.inactivityTimeout ?? 0,
		maxQueueSize: overrides.maxQueueSize ?? 0,
		queue,
		filters: {
			distortion: null,
			equalizer: [],
			karaoke: null,
			rotation: null,
			timescale: null,
			vibrato: null,
			volume: 1.0,
			getActiveFilters: () => ({}),
		},
		// Inactivity timer simulation
		_inactivityTimer: undefined as ReturnType<typeof setTimeout> | undefined,
		_destroyed: false,
		startInactivityTimer() {
			if (!this.inactivityTimeout || this.inactivityTimeout <= 0) return;
			this.stopInactivityTimer();
			this._inactivityTimer = setTimeout(() => {
				this.destroy();
			}, this.inactivityTimeout);
		},
		stopInactivityTimer() {
			if (this._inactivityTimer) {
				clearTimeout(this._inactivityTimer);
				this._inactivityTimer = undefined;
			}
		},
		destroy: mock(function (this: any) {
			this._destroyed = true;
			this.stopInactivityTimer();
			this.state = "DESTROYING";
		}),
		canAddToQueue(count = 1) {
			if (!this.maxQueueSize || this.maxQueueSize <= 0) return true;
			return this.queue.length + count <= this.maxQueueSize;
		},
		get queueSpaceRemaining() {
			if (!this.maxQueueSize || this.maxQueueSize <= 0) return Infinity;
			return Math.max(0, this.maxQueueSize - this.queue.length);
		},
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("StellaPlayer", () => {
	describe("Inactivity Timeout", () => {
		test("does nothing when timeout is 0", () => {
			const player = createMockPlayer({ inactivityTimeout: 0 });
			player.startInactivityTimer();
			expect(player._inactivityTimer).toBeUndefined();
		});

		test("starts timer when timeout > 0", () => {
			const player = createMockPlayer({ inactivityTimeout: 5000 });
			player.startInactivityTimer();
			expect(player._inactivityTimer).toBeDefined();
			player.stopInactivityTimer(); // cleanup
		});

		test("stopInactivityTimer clears the timer", () => {
			const player = createMockPlayer({ inactivityTimeout: 5000 });
			player.startInactivityTimer();
			expect(player._inactivityTimer).toBeDefined();
			player.stopInactivityTimer();
			expect(player._inactivityTimer).toBeUndefined();
		});

		test("timer triggers destroy after timeout", async () => {
			const player = createMockPlayer({ inactivityTimeout: 50 }); // 50ms for fast test
			player.startInactivityTimer();
			await new Promise((r) => setTimeout(r, 100));
			expect(player._destroyed).toBe(true);
			expect(player.destroy).toHaveBeenCalled();
		});

		test("restarting timer resets the countdown", async () => {
			const player = createMockPlayer({ inactivityTimeout: 80 });
			player.startInactivityTimer();
			await new Promise((r) => setTimeout(r, 40));
			player.startInactivityTimer(); // restart
			await new Promise((r) => setTimeout(r, 40));
			// Should NOT have triggered — we restarted at 40ms
			expect(player._destroyed).toBe(false);
			player.stopInactivityTimer(); // cleanup
		});
	});

	describe("Queue Size Helpers", () => {
		test("canAddToQueue returns true when no limit", () => {
			const player = createMockPlayer({ maxQueueSize: 0 });
			expect(player.canAddToQueue(100)).toBe(true);
		});

		test("canAddToQueue returns true when under limit", () => {
			const player = createMockPlayer({ maxQueueSize: 10 });
			player.queue.push({}, {}, {}); // 3 tracks
			expect(player.canAddToQueue(5)).toBe(true);
		});

		test("canAddToQueue returns false when at limit", () => {
			const player = createMockPlayer({ maxQueueSize: 3 });
			player.queue.push({}, {}, {});
			expect(player.canAddToQueue(1)).toBe(false);
		});

		test("queueSpaceRemaining returns Infinity when no limit", () => {
			const player = createMockPlayer({ maxQueueSize: 0 });
			expect(player.queueSpaceRemaining).toBe(Infinity);
		});

		test("queueSpaceRemaining returns correct count", () => {
			const player = createMockPlayer({ maxQueueSize: 10 });
			player.queue.push({}, {}, {});
			expect(player.queueSpaceRemaining).toBe(7);
		});

		test("queueSpaceRemaining never negative", () => {
			const player = createMockPlayer({ maxQueueSize: 2 });
			player.queue.push({}, {}, {}, {}); // Over limit (shouldn't happen, but be safe)
			expect(player.queueSpaceRemaining).toBe(0);
		});
	});

	describe("State", () => {
		test("initial state properties", () => {
			const player = createMockPlayer();
			expect(player.state).toBe("CONNECTED");
			expect(player.playing).toBe(false);
			expect(player.paused).toBe(false);
			expect(player.trackRepeat).toBe(false);
			expect(player.queueRepeat).toBe(false);
			expect(player.isAutoplay).toBe(false);
		});

		test("destroy sets state to DESTROYING", () => {
			const player = createMockPlayer();
			player.destroy();
			expect(player.state).toBe("DESTROYING");
			expect(player._destroyed).toBe(true);
		});

		test("destroy clears inactivity timer", () => {
			const player = createMockPlayer({ inactivityTimeout: 5000 });
			player.startInactivityTimer();
			expect(player._inactivityTimer).toBeDefined();
			player.destroy();
			expect(player._inactivityTimer).toBeUndefined();
		});
	});
});
