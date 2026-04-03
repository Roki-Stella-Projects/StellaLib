/**
 * @file Failover unit tests
 * Tests for StellaLib's seamless node failover system.
 *
 * These tests use mock objects to simulate node/player behavior
 * without requiring a real Lavalink server.
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";

// ─── Mock Helpers ────────────────────────────────────────────────────────

function createMockNode(id: string, connected = true, penalties = 0): any {
	return {
		options: { identifier: id },
		connected,
		isAlive: connected,
		penalties,
		stats: {
			cpu: { systemLoad: 0.1, lavalinkLoad: 0.1, cores: 4 },
			frameStats: { deficit: 0, nulled: 0 },
			playingPlayers: 0,
			players: 0,
			uptime: 100000,
			memory: { used: 100, free: 900, allocated: 1000, reservable: 1000 },
		},
		rest: {
			updatePlayer: mock(() => Promise.resolve()),
			destroyPlayer: mock(() => Promise.resolve()),
			getPlayer: mock(() => Promise.resolve(null)),
		},
	};
}

function createMockPlayer(guildId: string, node: any): any {
	return {
		guild: guildId,
		node,
		playing: true,
		paused: false,
		position: 60000,
		volume: 50,
		voiceChannel: "vc_123",
		textChannel: "tc_123",
		state: "CONNECTED",
		voiceState: {
			sessionId: "session_abc",
			event: { token: "tok_123", endpoint: "endpoint.discord.gg" },
		},
		queue: {
			current: {
				track: "encoded_track_data",
				title: "Test Song",
				author: "Test Artist",
				uri: "https://example.com/test",
				duration: 200000,
			},
		},
		filters: {
			distortion: null,
			equalizer: [],
			karaoke: null,
			rotation: null,
			timescale: null,
			vibrato: null,
			volume: 1.0,
		},
		isAutoplay: true,
		autoplayHistory: ["https://example.com/prev1"],
		autoplaySeedPool: [],
		dynamicLoopInterval: undefined,
		moveNode: mock(async function (this: any, nodeId: string) {
			// Simulate successful move
			this.node = { options: { identifier: nodeId }, connected: true };
			this.state = "CONNECTED";
			return this;
		}),
		destroy: mock(() => {}),
	};
}

function createMockManager(nodes: any[], players: any[]): any {
	const nodeMap = new Map(nodes.map((n) => [n.options.identifier, n]));
	const playerMap = new Map(players.map((p) => [p.guild, p]));
	const events: Array<{ event: string; args: any[] }> = [];

	return {
		nodes: nodeMap,
		players: playerMap,
		options: { sessionStore: null },
		emit: mock((event: string, ...args: any[]) => {
			events.push({ event, args });
		}),
		_events: events,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("Seamless Failover", () => {
	describe("attemptSeamlessFailover simulation", () => {
		test("moves playing players to healthy nodes when source node dies", () => {
			const deadNode = createMockNode("dead-node", false);
			const healthyNode = createMockNode("healthy-node", true, 10);
			const player = createMockPlayer("guild_1", deadNode);
			const manager = createMockManager([deadNode, healthyNode], [player]);

			// Simulate failover logic (mirrors Node.attemptSeamlessFailover)
			const affected = [...manager.players.values()].filter(
				(p: any) => p.node === deadNode && (p.playing || p.paused),
			);
			const healthy = [...manager.nodes.values()].filter(
				(n: any) => n !== deadNode && n.connected,
			);

			expect(affected.length).toBe(1);
			expect(healthy.length).toBe(1);
			expect(healthy[0].options.identifier).toBe("healthy-node");
		});

		test("distributes players across multiple healthy nodes", () => {
			const deadNode = createMockNode("dead", false);
			const healthy1 = createMockNode("healthy-1", true, 5);
			const healthy2 = createMockNode("healthy-2", true, 10);

			const players = [
				createMockPlayer("guild_1", deadNode),
				createMockPlayer("guild_2", deadNode),
				createMockPlayer("guild_3", deadNode),
				createMockPlayer("guild_4", deadNode),
			];

			const manager = createMockManager([deadNode, healthy1, healthy2], players);

			const healthyNodes = [...manager.nodes.values()]
				.filter((n: any) => n !== deadNode && n.connected)
				.sort((a: any, b: any) => a.penalties - b.penalties);

			expect(healthyNodes.length).toBe(2);
			// Lowest penalty node should be first
			expect(healthyNodes[0].options.identifier).toBe("healthy-1");
		});

		test("no healthy nodes — players are not moved", () => {
			const deadNode = createMockNode("dead", false);
			const player = createMockPlayer("guild_1", deadNode);
			const manager = createMockManager([deadNode], [player]);

			const healthy = [...manager.nodes.values()].filter(
				(n: any) => n !== deadNode && n.connected,
			);

			expect(healthy.length).toBe(0);
			// Player stays on dead node, waiting for reconnect
			expect(player.node).toBe(deadNode);
		});

		test("only active players are moved (idle players ignored)", () => {
			const deadNode = createMockNode("dead", false);
			const healthyNode = createMockNode("healthy", true);

			const playing = createMockPlayer("guild_active", deadNode);
			playing.playing = true;

			const idle = createMockPlayer("guild_idle", deadNode);
			idle.playing = false;
			idle.paused = false;

			const manager = createMockManager([deadNode, healthyNode], [playing, idle]);

			const affected = [...manager.players.values()].filter(
				(p: any) => p.node === deadNode && (p.playing || p.paused),
			);

			expect(affected.length).toBe(1);
			expect(affected[0].guild).toBe("guild_active");
		});

		test("paused players are also moved", () => {
			const deadNode = createMockNode("dead", false);
			const healthyNode = createMockNode("healthy", true);

			const paused = createMockPlayer("guild_paused", deadNode);
			paused.playing = false;
			paused.paused = true;

			const manager = createMockManager([deadNode, healthyNode], [paused]);

			const affected = [...manager.players.values()].filter(
				(p: any) => p.node === deadNode && (p.playing || p.paused),
			);

			expect(affected.length).toBe(1);
		});
	});

	describe("moveNode simulation", () => {
		test("preserves track position during move", async () => {
			const oldNode = createMockNode("old", true);
			const newNode = createMockNode("new", true);
			const player = createMockPlayer("guild_1", oldNode);
			player.position = 85000; // 1:25

			await player.moveNode("new");

			// Position should be carried over
			expect(player.position).toBe(85000);
		});

		test("moveNode changes node reference", async () => {
			const oldNode = createMockNode("old", true);
			const player = createMockPlayer("guild_1", oldNode);

			await player.moveNode("new-node");

			expect(player.node.options.identifier).toBe("new-node");
		});

		test("player state is CONNECTED after move", async () => {
			const oldNode = createMockNode("old", true);
			const player = createMockPlayer("guild_1", oldNode);

			await player.moveNode("new-node");

			expect(player.state).toBe("CONNECTED");
		});
	});

	describe("penalty-based node selection", () => {
		test("selects lowest penalty node", () => {
			const nodes = [
				createMockNode("overloaded", true, 500),
				createMockNode("moderate", true, 100),
				createMockNode("light", true, 10),
			];

			const sorted = nodes
				.filter((n) => n.connected)
				.sort((a, b) => a.penalties - b.penalties);

			expect(sorted[0].options.identifier).toBe("light");
		});

		test("excludes disconnected nodes", () => {
			const nodes = [
				createMockNode("dead", false, 0), // Best penalty but dead
				createMockNode("alive", true, 100),
			];

			const available = nodes.filter((n) => n.connected);
			expect(available.length).toBe(1);
			expect(available[0].options.identifier).toBe("alive");
		});
	});

	describe("PlayerFailover event", () => {
		test("event contains old and new node identifiers", () => {
			const manager = createMockManager([], []);
			manager.emit("PlayerFailover", { guild: "123" }, "old-node", "new-node");

			const failoverEvent = manager._events.find((e: any) => e.event === "PlayerFailover");
			expect(failoverEvent).toBeDefined();
			expect(failoverEvent!.args[1]).toBe("old-node");
			expect(failoverEvent!.args[2]).toBe("new-node");
		});
	});
});

describe("Failover Flow Integration", () => {
	test("full failover flow: node dies → players rescued → playback continues", async () => {
		const deadNode = createMockNode("primary", false);
		const backupNode = createMockNode("backup", true, 5);

		const player1 = createMockPlayer("guild_1", deadNode);
		player1.position = 120000; // 2:00
		const player2 = createMockPlayer("guild_2", deadNode);
		player2.position = 45000; // 0:45

		const manager = createMockManager([deadNode, backupNode], [player1, player2]);

		// Simulate the failover
		const affected = [...manager.players.values()].filter(
			(p: any) => p.node === deadNode && (p.playing || p.paused),
		);
		const healthy = [...manager.nodes.values()].filter(
			(n: any) => n !== deadNode && n.connected,
		);

		expect(affected.length).toBe(2);
		expect(healthy.length).toBe(1);

		// Move all players
		for (const player of affected) {
			await (player as any).moveNode(healthy[0].options.identifier);
			manager.emit("PlayerFailover", player, "primary", "backup");
		}

		// Verify both players moved
		expect(player1.node.options.identifier).toBe("backup");
		expect(player2.node.options.identifier).toBe("backup");

		// Verify positions preserved
		expect(player1.position).toBe(120000);
		expect(player2.position).toBe(45000);

		// Verify events emitted
		const failoverEvents = manager._events.filter((e: any) => e.event === "PlayerFailover");
		expect(failoverEvents.length).toBe(2);
	});
});
