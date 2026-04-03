/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * Derived from LithiumX — Copyright (c) 2025 Anantix Network (MIT)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 */
import type {
	LavalinkResponse,
	NodeOptions,
	NodeStats,
	LavalinkInfo,
	LavalinkVersion,
	PlaylistRawData,
	PlayerEvent,
	PlayerEvents,
	TrackData,
	TrackEndEvent,
	TrackExceptionEvent,
	TrackStartEvent,
	TrackStuckEvent,
	Track,
	UnresolvedTrack,
	WebSocketClosedEvent,
} from "./Types";
import type { StellaManager } from "./Manager";
import type { StellaPlayer } from "./Player";
import { Structure, TrackUtils } from "./Utils";
import { StellaRest } from "./Rest";
import nodeCheck from "../Utils/NodeCheck";
import WebSocket from "ws";

/** Lavalink close codes that should NOT trigger a reconnect. */
const FATAL_CLOSE_CODES = new Set([
	4001, // Authentication failed
	4004, // Authentication failed (not configured)
]);

/** Lavalink close codes where session is invalidated and should be cleared. */
const SESSION_INVALID_CODES = new Set([
	4006, // Session is no longer valid
	4009, // Session timed out
]);

class StellaNode {
	/** The WebSocket connection for the node. */
	public socket: WebSocket | null = null;
	/** The stats for the node. */
	public stats: NodeStats;
	/** The Manager instance. */
	public manager: StellaManager;
	/** The node's session ID from Lavalink. */
	public sessionId: string | null = null;
	/** The REST instance. */
	public readonly rest: StellaRest;
	/** Whether the connection is alive (heartbeat). */
	public isAlive = false;
	/** Timestamp of last successful pong. */
	public lastHeartbeatAck = 0;
	/** Lavalink server info (cached after first fetch). */
	public info: LavalinkInfo | null = null;
	/** Detected Lavalink version (3 or 4). Auto-detected on connect. */
	public version: LavalinkVersion = 4;

	/** Timestamp of the last playerUpdate received from this node. Used for zombie detection. */
	public lastPlayerUpdate = 0;

	private static _manager: StellaManager;
	private reconnectTimeout?: ReturnType<typeof setTimeout>;
	private reconnectAttempts = 1;
	private heartbeatTimer?: ReturnType<typeof setInterval>;
	private statsLastUpdated = 0;

	/** Returns if connected to the Node. */
	public get connected(): boolean {
		if (!this.socket) return false;
		return this.socket.readyState === WebSocket.OPEN;
	}

	/** Returns the address for this node. */
	public get address(): string {
		return `${this.options.host}:${this.options.port}`;
	}

	/** Returns the uptime of the connection in ms. */
	public get uptime(): number {
		return this.stats.uptime;
	}

	/** Returns the penalty score for load balancing (lower = better). */
	public get penalties(): number {
		const stats = this.stats;
		if (!stats) return 0;

		let penalties = 0;

		// CPU load penalty
		if (stats.cpu) {
			penalties += Math.pow(1.05, 100 * stats.cpu.systemLoad) * 10 - 10;
			penalties += Math.pow(1.03, 100 * (stats.cpu.lavalinkLoad / Math.max(stats.cpu.cores, 1))) * 5 - 5;
		}

		// Frame deficit/null penalty
		if (stats.frameStats) {
			if (stats.frameStats.deficit && stats.frameStats.deficit > 0) {
				penalties += Math.pow(1.03, 500 * (stats.frameStats.deficit / 3000)) * 600 - 600;
			}
			if (stats.frameStats.nulled && stats.frameStats.nulled > 0) {
				penalties += Math.pow(1.03, 500 * (stats.frameStats.nulled / 3000)) * 300 - 300;
			}
		}

		// Player count penalty
		penalties += stats.playingPlayers;

		return penalties;
	}

	/** @hidden */
	public static init(manager: StellaManager): void {
		this._manager = manager;
	}

	/**
	 * Creates an instance of StellaNode.
	 * @param options The node options.
	 */
	constructor(public options: NodeOptions) {
		if (!this.manager) this.manager = Structure.get("Node")._manager;
		if (!this.manager) throw new RangeError("Manager has not been initiated.");

		if (this.manager.nodes.has(options.identifier || options.host)) {
			return this.manager.nodes.get(options.identifier || options.host)!;
		}

		nodeCheck(options);

		this.options = {
			port: 2333,
			password: "youshallnotpass",
			secure: false,
			retryAmount: 30,
			retryDelay: 60000,
			priority: 0,
			resumeStatus: true,
			resumeTimeout: 60,
			requestTimeout: 15000,
			heartbeatInterval: 30000,
			...options,
		};

		if (this.options.secure) {
			this.options.port = 443;
		}

		this.options.identifier = options.identifier || options.host;
		this.stats = {
			players: 0,
			playingPlayers: 0,
			uptime: 0,
			memory: { free: 0, used: 0, allocated: 0, reservable: 0 },
			cpu: { cores: 0, systemLoad: 0, lavalinkLoad: 0 },
			frameStats: { sent: 0, nulled: 0, deficit: 0 },
		};

		this.manager.nodes.set(this.options.identifier!, this);
		this.manager.emit("NodeCreate", this);
		this.rest = new StellaRest(this);
	}

	/** Sends a JSON payload over the WebSocket (used for v3 ops). */
	public sendWs(data: object): void {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
		this.socket.send(JSON.stringify(data));
	}

	/**
	 * Auto-detects the Lavalink version by probing REST endpoints.
	 * Tries v4 /v4/info first, falls back to v3 /version.
	 */
	private async detectVersion(): Promise<void> {
		const protocol = this.options.secure ? "https" : "http";
		const baseUrl = `${protocol}://${this.address}`;
		const headers = { Authorization: this.options.password! };

		// Try v4 first
		try {
			const res = await fetch(`${baseUrl}/v4/info`, {
				headers,
				signal: AbortSignal.timeout(5000),
			});
			if (res.ok) {
				this.version = 4;
				this.info = (await res.json()) as LavalinkInfo;
				this.rest.setVersion(4);
				this.manager.emit(
					"Debug",
					`[Node:${this.options.identifier}] Detected Lavalink v4 (${this.info.version.semver})`,
				);
				return;
			}
		} catch {
			// Not v4, try v3
		}

		// Try v3
		try {
			const res = await fetch(`${baseUrl}/version`, {
				headers,
				signal: AbortSignal.timeout(5000),
			});
			if (res.ok) {
				const versionStr = (await res.text()).trim();
				this.version = 3;
				this.rest.setVersion(3);
				this.manager.emit(
					"Debug",
					`[Node:${this.options.identifier}] Detected Lavalink v3 (${versionStr})`,
				);
				return;
			}
		} catch {
			// Fall through
		}

		// Default to v4
		this.version = 4;
		this.rest.setVersion(4);
		this.manager.emit(
			"Debug",
			`[Node:${this.options.identifier}] Could not detect version, defaulting to v4`,
		);
	}

	/** Connects to the Node, auto-detecting version and loading persisted session. */
	public async connect(): Promise<void> {
		if (this.connected) return;

		// Auto-detect Lavalink version before connecting
		await this.detectVersion();

		// Try to load session ID / resume key from store
		if (!this.sessionId && this.manager.options.sessionStore) {
			try {
				const saved = await this.manager.options.sessionStore.get(this.options.identifier!);
				if (saved) {
					this.sessionId = saved;
					this.manager.emit(
						"Debug",
						`[Node:${this.options.identifier}] Loaded persisted sessionId: ${saved}`,
					);
				}
			} catch {
				// Ignore store errors
			}
		}

		const headers: Record<string, string> = {
			Authorization: this.options.password!,
			"Num-Shards": String(this.manager.options.shards ?? 1),
			"User-Id": this.manager.options.clientId!,
			"Client-Name": this.manager.options.clientName!,
		};

		// v3 uses Resume-Key header, v4 uses Session-Id header
		if (this.version === 3) {
			if (this.sessionId) headers["Resume-Key"] = this.sessionId;
		} else {
			if (this.sessionId) headers["Session-Id"] = this.sessionId;
		}

		// v3 connects to ws://host:port, v4 to ws://host:port/v4/websocket
		const protocol = this.options.secure ? "wss" : "ws";
		const url = this.version === 3
			? `${protocol}://${this.address}`
			: `${protocol}://${this.address}/v4/websocket`;

		this.manager.emit("Debug", `[Node:${this.options.identifier}] Connecting to ${url}${this.sessionId ? " (resuming)" : ""}`);

		const wsOptions: WebSocket.ClientOptions = { headers };

		// Enable per-message deflate compression if configured
		if (this.options.wsCompression) {
			wsOptions.perMessageDeflate = {
				zlibDeflateOptions: { level: 6 },
				threshold: 128,
			};
			this.manager.emit(
				"Debug",
				`[Node:${this.options.identifier}] WebSocket compression enabled (perMessageDeflate)`,
			);
		}

		this.socket = new WebSocket(url, wsOptions);
		this.socket.on("open", this.open.bind(this));
		this.socket.on("close", this.close.bind(this));
		this.socket.on("message", this.message.bind(this));
		this.socket.on("error", this.error.bind(this));
		this.socket.on("pong", this.heartbeatAck.bind(this));
	}

	/** Destroys the Node. Attempts to move players to other healthy nodes first (auto-failover). */
	public destroy(): void {
		if (!this.connected && !this.socket) return;

		this.stopHeartbeat();

		// Auto-failover: try to move players to other healthy nodes instead of destroying them
		const affectedPlayers = [...this.manager.players.values()].filter((p) => p.node === this);
		const healthyNodes = [...this.manager.nodes.values()].filter(
			(n) => n !== this && n.connected,
		);

		for (const player of affectedPlayers) {
			if (healthyNodes.length > 0) {
				// Pick the least-loaded healthy node
				const target = healthyNodes.sort((a, b) => a.penalties - b.penalties)[0];
				this.manager.emit(
					"Debug",
					`[Node:${this.options.identifier}] Failover: moving player ${player.guild} → ${target.options.identifier}`,
				);
				player.moveNode(target.options.identifier).catch(() => {
					// If move fails, destroy the player
					player.destroy();
				});
			} else {
				player.destroy();
			}
		}

		this.socket?.close(1000, "destroy");
		this.socket?.removeAllListeners();
		this.socket = null;
		this.isAlive = false;

		this.reconnectAttempts = 1;
		if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);

		this.manager.emit("NodeDestroy", this);
		this.manager.nodes.delete(this.options.identifier!);
	}

	/** Gracefully closes the connection, persisting the session for resume. */
	public async gracefulClose(): Promise<void> {
		this.stopHeartbeat();

		// Persist session before closing
		if (this.sessionId && this.manager.options.sessionStore) {
			try {
				await this.manager.options.sessionStore.set(this.options.identifier!, this.sessionId);
			} catch {
				// Ignore
			}
		}

		this.socket?.close(1000, "graceful");
		this.socket?.removeAllListeners();
		this.socket = null;
		this.isAlive = false;

		if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
	}

	/** Starts the heartbeat interval to detect dead connections. */
	private startHeartbeat(): void {
		this.stopHeartbeat();
		const interval = this.options.heartbeatInterval ?? 30000;
		if (interval <= 0) return;

		this.isAlive = true;
		this.lastHeartbeatAck = Date.now();

		this.heartbeatTimer = setInterval(() => {
			if (!this.connected) {
				this.stopHeartbeat();
				return;
			}

			// If we haven't received a pong since last ping, connection is dead
			if (!this.isAlive) {
				this.manager.emit(
					"Debug",
					`[Node:${this.options.identifier}] Heartbeat timeout — connection assumed dead`,
				);
				this.socket?.terminate();
				return;
			}

			this.isAlive = false;
			this.socket?.ping();
		}, interval);
	}

	/** Stops the heartbeat interval. */
	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}

	/** Called when a pong is received from the server. */
	private heartbeatAck(): void {
		this.isAlive = true;
		this.lastHeartbeatAck = Date.now();
	}

	/**
	 * Reconnects to the node with exponential backoff + jitter.
	 * First attempt uses a fast retry (2s) for quick recovery from transient failures.
	 * Jitter prevents thundering herd when multiple nodes reconnect simultaneously.
	 */
	private reconnect(): void {
		const baseDelay = this.options.retryDelay ?? 60000;
		const maxDelay = 120000;

		// Fast retry for first attempt — most disconnects are transient
		let delay: number;
		if (this.reconnectAttempts <= 1) {
			delay = 2000 + Math.floor(Math.random() * 1000);
		} else {
			const exponentialDelay = Math.min(baseDelay * Math.pow(1.5, this.reconnectAttempts - 1), maxDelay);
			// Add ±25% jitter
			const jitter = exponentialDelay * (0.75 + Math.random() * 0.5);
			delay = Math.floor(jitter);
		}

		this.manager.emit(
			"Debug",
			`[Node:${this.options.identifier}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.options.retryAmount ?? 30})`,
		);

		this.reconnectTimeout = setTimeout(() => {
			if (this.reconnectAttempts >= (this.options.retryAmount ?? 30)) {
				const error = new Error(
					`Unable to connect after ${this.options.retryAmount} attempts.`,
				);
				this.manager.emit("NodeError", this, error);
				return this.destroy();
			}

			this.socket?.removeAllListeners();
			this.socket = null;
			this.manager.emit("NodeReconnect", this);
			this.connect();
			this.reconnectAttempts++;
		}, delay);
	}

	protected open(): void {
		if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
		this.reconnectAttempts = 1;
		this.startHeartbeat();
		this.manager.emit("NodeConnect", this);
		this.manager.emit("Debug", `[Node:${this.options.identifier}] Connected`);

		// v3 has no "ready" op — handle session setup immediately on open
		if (this.version === 3) {
			const hadPriorSession = !!this.sessionId;
			if (!this.sessionId) {
				this.sessionId = `StellaLib-${this.options.identifier}-${Date.now()}`;
			}
			this.handleReady({ sessionId: this.sessionId, resumed: hadPriorSession });
		}
	}

	protected close(code: number, reason: Buffer): void {
		const reasonStr = reason.toString();
		this.stopHeartbeat();
		this.isAlive = false;

		this.manager.emit("NodeDisconnect", this, { code, reason: reasonStr });
		this.manager.emit(
			"Debug",
			`[Node:${this.options.identifier}] Disconnected (code: ${code}, reason: ${reasonStr})`,
		);

		// Fatal close codes — don't retry
		if (FATAL_CLOSE_CODES.has(code)) {
			this.manager.emit(
				"NodeError",
				this,
				new Error(`[Node:${this.options.identifier}] Fatal close code ${code}: ${reasonStr}. Not reconnecting.`),
			);
			// Even on fatal, try to rescue playing players
			this.attemptSeamlessFailover("fatal_close");
			return;
		}

		// Session invalidated — clear session ID so we get a fresh one
		if (SESSION_INVALID_CODES.has(code)) {
			this.manager.emit(
				"Debug",
				`[Node:${this.options.identifier}] Session invalidated (code: ${code}), clearing sessionId`,
			);
			this.sessionId = null;
			if (this.manager.options.sessionStore) {
				try { this.manager.options.sessionStore.delete(this.options.identifier!); } catch { /* ignore */ }
			}
		}

		// Seamless failover: immediately move playing players to healthy nodes
		// instead of waiting for this node to reconnect (which may take seconds)
		if (code !== 1000 || reasonStr !== "destroy") {
			this.attemptSeamlessFailover("unexpected_close");
			this.reconnect();
		}
	}

	/**
	 * Attempts to seamlessly move all players from this (dead) node to healthy nodes.
	 * Preserves current track position so audio continues without interruption.
	 * Players that fail to move are left for the reconnect cycle to recover.
	 */
	private attemptSeamlessFailover(reason: string): void {
		const affectedPlayers = [...this.manager.players.values()].filter(
			(p) => p.node === this && (p.playing || p.paused),
		);

		if (!affectedPlayers.length) return;

		const healthyNodes = [...this.manager.nodes.values()].filter(
			(n) => n !== this && n.connected,
		);

		if (!healthyNodes.length) {
			this.manager.emit(
				"Debug",
				`[Failover:${this.options.identifier}] No healthy nodes available — ${affectedPlayers.length} player(s) waiting for reconnect`,
			);
			return;
		}

		// Sort healthy nodes by penalty (best first)
		healthyNodes.sort((a, b) => a.penalties - b.penalties);

		this.manager.emit(
			"Debug",
			`[Failover:${this.options.identifier}] Seamless failover triggered (${reason}) — moving ${affectedPlayers.length} player(s) to healthy nodes`,
		);

		for (const player of affectedPlayers) {
			// Distribute players across available nodes (round-robin by penalty)
			const targetNode = healthyNodes.reduce((best, n) => {
				const bestLoad = [...this.manager.players.values()].filter((p) => p.node === best).length;
				const nLoad = [...this.manager.players.values()].filter((p) => p.node === n).length;
				return nLoad < bestLoad ? n : best;
			}, healthyNodes[0]);

			const oldNodeId = this.options.identifier!;
			const newNodeId = targetNode.options.identifier!;

			this.manager.emit(
				"Debug",
				`[Failover] Moving player ${player.guild} (pos: ${player.position}ms) → ${newNodeId}`,
			);

			player.moveNode(newNodeId)
				.then(() => {
					this.manager.emit("PlayerFailover", player, oldNodeId, newNodeId);
					this.manager.emit(
						"Debug",
						`[Failover] Player ${player.guild} successfully moved to ${newNodeId} — playback continues`,
					);
				})
				.catch((err) => {
					this.manager.emit(
						"Debug",
						`[Failover] Failed to move player ${player.guild}: ${err instanceof Error ? err.message : String(err)} — will retry on reconnect`,
					);
				});
		}
	}

	protected error(error: Error): void {
		if (!error) return;
		this.manager.emit("NodeError", this, error);
	}

	protected message(d: Buffer | string): void {
		if (Array.isArray(d)) d = Buffer.concat(d);
		else if (d instanceof ArrayBuffer) d = Buffer.from(d);

		const payload = JSON.parse(d.toString());
		if (!payload.op) return;

		this.manager.emit("NodeRaw", payload);

		switch (payload.op) {
			case "stats":
				delete payload.op;
				this.stats = { ...payload } as unknown as NodeStats;
				this.statsLastUpdated = Date.now();
				break;

			case "playerUpdate": {
				this.lastPlayerUpdate = Date.now();
				const player = this.manager.players.get(payload.guildId);
				if (player) {
					player.position = payload.state.position || 0;
					// v3 playerUpdate may not include connected/ping
					if (payload.state.connected !== undefined) player.connected = payload.state.connected;
					if (payload.state.ping !== undefined) player.ping = payload.state.ping;
				}
				break;
			}

			case "event":
				this.handleEvent(payload);
				break;

			case "ready":
				this.handleReady(payload);
				break;

			default:
				this.manager.emit(
					"NodeError",
					this,
					new Error(`Unexpected op "${payload.op}" with data: ${payload.message}`),
				);
				return;
		}
	}

	/** Handles the 'ready' op from Lavalink (v4) or synthetic ready (v3). */
	private handleReady(payload: { sessionId: string; resumed: boolean }): void {
		this.rest.setSessionId(payload.sessionId);
		this.sessionId = payload.sessionId;

		this.manager.emit(
			"Debug",
			`[Node:${this.options.identifier}] Ready — sessionId: ${payload.sessionId}, resumed: ${payload.resumed}`,
		);

		// Persist session ID / resume key for bot restart resume
		if (this.manager.options.sessionStore) {
			try {
				this.manager.options.sessionStore.set(this.options.identifier!, payload.sessionId);
			} catch {
				// Best effort
			}
		}

		// Configure session resuming — version-aware (v3: WS op, v4: REST PATCH)
		if (this.options.resumeStatus) {
			this.rest
				.configureResume(this.options.resumeTimeout ?? 60)
				.catch((err: unknown) => {
					this.manager.emit(
						"NodeError",
						this,
						new Error(`Failed to configure session resume: ${(err as Error).message}`),
					);
				});
		}

		// Sync players from Lavalink (v4 only — v3 has no player list endpoint)
		if (this.version === 4) {
			this.syncPlayers().catch((err: unknown) => {
				this.manager.emit(
					"Debug",
					`[Node:${this.options.identifier}] Player sync: ${(err as Error).message}`,
				);
			});
		}

		// For non-resumed sessions, also try rebuilding players from local state
		if (!payload.resumed && this.reconnectAttempts <= 1) {
			this.rebuildPlayers().catch((err: unknown) => {
				this.manager.emit(
					"Debug",
					`[Node:${this.options.identifier}] Player rebuild skipped: ${(err as Error).message}`,
				);
			});
		}

		// Fetch and cache Lavalink info (if not already detected)
		if (!this.info) {
			this.fetchInfo().catch(() => {});
		}
	}

	/** Fetches and caches Lavalink server info (version-aware). */
	public async fetchInfo(): Promise<LavalinkInfo> {
		const info = await this.rest.getInfo();
		this.info = info;
		this.manager.emit(
			"Debug",
			`[Node:${this.options.identifier}] Lavalink v${info.version.semver}, lavaplayer: ${info.lavaplayer}`,
		);
		return info;
	}

	/** Syncs player states after a session resume. */
	private async syncPlayers(): Promise<void> {
		const players = (await this.rest.getAllPlayers()) as Array<{
			guildId: string;
			track: { encoded: string; info: Record<string, unknown> } | null;
			volume: number;
			paused: boolean;
			state: { position: number; connected: boolean; ping: number };
			voice: { token: string; endpoint: string; sessionId: string; channelId?: string };
			filters: Record<string, unknown>;
		}>;

		if (!Array.isArray(players)) return;

		for (const data of players) {
			let player = this.manager.players.get(data.guildId);

			// Player exists on Lavalink but not locally — recreate it
			if (!player) {
				this.manager.emit(
					"Debug",
					`[Node:${this.options.identifier}] Restoring player for guild ${data.guildId} from Lavalink`,
				);

				player = this.manager.create({
					guild: data.guildId,
					voiceChannel: data.voice?.channelId ?? undefined,
					textChannel: undefined,
					selfDeafen: true,
					node: this.options.identifier,
					volume: data.volume,
				});

				// Mark voice as ready since Lavalink is already connected
				player.state = "CONNECTED";
				player.voiceReady = true;
				player.connected = data.state.connected;
			}

			// Restore persisted player state (autoplay, queue, filters, history)
			const store = this.manager.getPlayerStateStore();
			if (store) {
				try {
					const savedState = await store.getPlayerState(data.guildId);
					if (savedState) {
						player.restoreFromState(savedState);
						this.manager.emit(
							"Debug",
							`[Node:${this.options.identifier}] Restored persisted state for guild ${data.guildId} (autoplay: ${savedState.isAutoplay})`,
						);
						// Clean up persisted state after successful restore
						await store.deletePlayerState(data.guildId);
					}
				} catch {
					// Ignore restore errors
				}
			}

			player.position = data.state.position;
			player.connected = data.state.connected;
			player.ping = data.state.ping;
			player.volume = data.volume;
			player.paused = data.paused;
			player.playing = !data.paused && data.track !== null;

			// Rebuild current track from Lavalink data if we lost it
			if (data.track && !player.queue.current) {
				try {
					player.queue.current = TrackUtils.build(
						{ encoded: data.track.encoded, info: data.track.info as any, pluginInfo: {} },
						player.get<string>("Internal_BotUser"),
					);
				} catch {
					// Ignore track rebuild errors
				}
			}

			// Force Discord to re-establish voice connection with fresh tokens
			// This prevents the ~15-20s cutoff after restart when voice tokens expire
			if (data.voice?.channelId && this.manager.options.send) {
				setTimeout(() => {
					this.manager.emit(
						"Debug",
						`[Node:${this.options.identifier}] Re-joining voice channel ${data.voice?.channelId} for guild ${data.guildId} to refresh tokens`,
					);
					this.manager.options.send(data.guildId, {
						op: 4,
						d: {
							guild_id: data.guildId,
							channel_id: data.voice?.channelId ?? null,
							self_mute: false,
							self_deaf: true,
						},
					});
				}, 1500); // Small delay to let player state settle
			}

			this.manager.emit(
				"Debug",
				`[Node:${this.options.identifier}] Synced player for guild ${data.guildId} (pos: ${data.state.position}, playing: ${player.playing}, track: ${data.track?.info?.title ?? "none"})`,
			);
		}
	}

	/**
	 * Attempts to rebuild players that have a voice state but lost their Lavalink player
	 * (e.g., after bot restart with session persistence).
	 */
	private async rebuildPlayers(): Promise<void> {
		for (const [, player] of this.manager.players) {
			if (player.node !== this) continue;
			if (!player.voiceState?.sessionId || !player.voiceState?.event) continue;

			try {
				// Re-send voice state to Lavalink
				await this.rest.updatePlayer({
					guildId: player.guild,
					data: {
						voice: {
							token: player.voiceState.event.token,
							endpoint: player.voiceState.event.endpoint,
							sessionId: player.voiceState.sessionId,
							channelId: player.voiceChannel ?? undefined,
						},
					},
				});

				// Re-send track if we have one
				if (player.queue.current?.track) {
					await this.rest.updatePlayer({
						guildId: player.guild,
						data: {
							encodedTrack: player.queue.current.track,
							position: player.position,
							volume: player.volume,
							paused: player.paused,
						},
					});
				}

				this.manager.emit(
					"Debug",
					`[Node:${this.options.identifier}] Rebuilt player for guild ${player.guild}`,
				);
			} catch {
				// Ignore rebuild errors — the player may not be recoverable
			}
		}
	}

	protected async handleEvent(payload: PlayerEvent & PlayerEvents): Promise<void> {
		if (!payload.guildId) return;

		const player = this.manager.players.get(payload.guildId);
		if (!player) return;

		const track = player.queue.current;
		const type = payload.type;

		switch (type) {
			case "TrackStartEvent":
				this.trackStart(player, track as Track, payload as TrackStartEvent);
				break;
			case "TrackEndEvent":
				this.trackEnd(player, track as Track, payload as TrackEndEvent);
				break;
			case "TrackStuckEvent":
				this.trackStuck(player, track as Track, payload as unknown as TrackStuckEvent);
				break;
			case "TrackExceptionEvent":
				this.trackError(player, track as Track | UnresolvedTrack, payload as TrackExceptionEvent);
				break;
			case "WebSocketClosedEvent":
				this.socketClosed(player, payload as WebSocketClosedEvent);
				break;
			default:
				this.manager.emit(
					"NodeError",
					this,
					new Error(`Node#event unknown event '${type}'.`),
				);
				break;
		}
	}

	protected trackStart(player: StellaPlayer, track: Track, payload: TrackStartEvent): void {
		player.playing = true;
		player.paused = false;

		// Restore volume after crossfade (previous track faded out, new track starts at full volume)
		if (player.crossfadeDuration > 0) {
			this.manager.emit(
				"Debug",
				`[Player:${player.guild}] Crossfade: restoring volume to ${player.volume} for new track`,
			);
			player.node.rest.updatePlayer({
				guildId: player.guild,
				data: { volume: player.volume },
			}).catch(() => {});
		}

		this.manager.emit("TrackStart", player, track, payload);
	}

	protected async trackEnd(player: StellaPlayer, track: Track, payload: TrackEndEvent): Promise<void> {
		const { reason } = payload;

		if (["loadFailed", "cleanup"].includes(reason)) {
			this.handleFailedTrack(player, track, payload);
		} else if (reason === "replaced") {
			this.manager.emit("TrackEnd", player, track, payload);
			player.queue.previous = player.queue.current;
		} else if (track && (player.trackRepeat || player.queueRepeat)) {
			this.handleRepeatedTrack(player, track, payload);
		} else if (player.queue.length) {
			this.playNextTrack(player, track, payload);
		} else {
			await this.queueEnd(player, track, payload);
		}
	}

	public extractSpotifyTrackID(url: string): string | null {
		const match = url.match(/https:\/\/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
		return match ? match[1] : null;
	}

	public extractSpotifyArtistID(url: string): string | null {
		const match = url.match(/https:\/\/open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/);
		return match ? match[1] : null;
	}

	/**
	 * Smart auto-mix: finds the best transition track for seamless 24/7 playback.
	 *
	 * Scores candidates on:
	 * - Duration similarity (±30s = perfect, ±2min = good)
	 * - Author match (same artist = high score, shared words = partial)
	 * - Title keyword overlap (shared theme/language)
	 * - Source consistency (same platform bonus)
	 * - Seed pool diversity (avoids drifting into one artist)
	 *
	 * Uses multi-seed context from the last 5 tracks for better recommendations.
	 */
	private async handleAutoplay(player: StellaPlayer, track: Track): Promise<void> {
		const previousTrack = player.queue.previous as Track | null;
		if (!player.isAutoplay || !previousTrack) return;

		const requester = player.get("Internal_BotUser") as string;
		const historySet = new Set(player.autoplayHistory);

		// ── Update seed pool with the track that just finished ──────────────
		const newSeedEntry = {
			title: previousTrack.title ?? "",
			author: previousTrack.author ?? "",
			uri: previousTrack.uri ?? "",
			duration: previousTrack.duration ?? 0,
			sourceName: previousTrack.sourceName ?? "",
		};
		// Set anchor on first call — anchors the style to the user's original pick
		if (!player.autoplayAnchor) {
			player.autoplayAnchor = newSeedEntry;
		}
		player.autoplaySeedPool.push(newSeedEntry);
		if (player.autoplaySeedPool.length > 5) {
			player.autoplaySeedPool.shift();
		}

		const seedPool = player.autoplaySeedPool;
		const anchor = player.autoplayAnchor;
		const avgDuration = seedPool.reduce((sum, s) => sum + s.duration, 0) / (seedPool.length || 1);

		// ── Transition scoring engine ───────────────────────────────────────
		const scoreTrack = (candidate: Track): number => {
			let score = 0;

			// Duration similarity: ±30s = +40, ±60s = +25, ±120s = +10
			const durDiff = Math.abs((candidate.duration ?? 0) - avgDuration);
			if (durDiff < 30_000) score += 40;
			else if (durDiff < 60_000) score += 25;
			else if (durDiff < 120_000) score += 10;

			const candAuthor = (candidate.author ?? "").toLowerCase();
			const candTitle = (candidate.title ?? "").toLowerCase();
			const candTitleWords = candTitle.split(/[\s\-_()[\]]+/).filter((w) => w.length > 2);

			// Author match against previous track
			const prevAuthor = (previousTrack.author ?? "").toLowerCase();
			if (prevAuthor && candAuthor) {
				if (candAuthor === prevAuthor) {
					score += 30;
				} else {
					// Partial word overlap (e.g. "Silo" in "Silo Music")
					const prevWords = prevAuthor.split(/[\s,&]+/).filter((w) => w.length > 2);
					const cWords = candAuthor.split(/[\s,&]+/).filter((w) => w.length > 2);
					const overlap = prevWords.filter((w) => cWords.includes(w)).length;
					score += Math.min(overlap * 10, 20);
				}
			}

			// Title keyword overlap (shared theme/vibe/language)
			const prevTitle = (previousTrack.title ?? "").toLowerCase();
			if (prevTitle) {
				const prevWords = prevTitle.split(/[\s\-_()[\]]+/).filter((w) => w.length > 2);
				const overlap = prevWords.filter((w) => candTitleWords.includes(w)).length;
				score += Math.min(overlap * 8, 24);
			}

			// ── Anchor similarity (prevents style drift from the user's original pick) ──
			if (anchor) {
				const anchorAuthor = anchor.author.toLowerCase();
				const anchorTitle = anchor.title.toLowerCase();
				// Author match to anchor
				if (candAuthor && anchorAuthor) {
					if (candAuthor === anchorAuthor) {
						score += 25;
					} else {
						const anchorWords = anchorAuthor.split(/[\s,&]+/).filter((w) => w.length > 2);
						const cWords = candAuthor.split(/[\s,&]+/).filter((w) => w.length > 2);
						const overlap = anchorWords.filter((w) => cWords.includes(w)).length;
						score += Math.min(overlap * 8, 16);
					}
				}
				// Title keyword overlap with anchor
				if (anchorTitle) {
					const anchorTitleWords = anchorTitle.split(/[\s\-_()[\]]+/).filter((w) => w.length > 2);
					const overlap = anchorTitleWords.filter((w) => candTitleWords.includes(w)).length;
					score += Math.min(overlap * 6, 18);
				}
				// Source match to anchor (keep same platform as original)
				if (candidate.sourceName === anchor.sourceName) {
					score += 5;
				}
			}

			// ── Seed-pool-wide author affinity ──────────────────────────────
			// Bonus if candidate's author appears anywhere in recent seeds
			if (candAuthor) {
				const seedAuthorMatches = seedPool.filter((s) => s.author.toLowerCase() === candAuthor).length;
				if (seedAuthorMatches > 0) score += Math.min(seedAuthorMatches * 8, 16);
			}

			// Seed pool diversity bonus: avoid same author for 3+ tracks in a row
			const recentAuthors = seedPool.slice(-3).map((s) => s.author.toLowerCase());
			const authorRepeatCount = recentAuthors.filter((a) => a === candAuthor).length;
			if (authorRepeatCount === 0 && candAuthor !== prevAuthor) {
				score += 15; // Diversity bonus — fresh artist
			} else if (authorRepeatCount >= 2) {
				score -= 20; // Penalty — too repetitive
			}

			// Source consistency: prefer same platform for smoother vibe
			if (candidate.sourceName === previousTrack.sourceName) {
				score += 5;
			}

			// Not a stream (streams have unknown duration, bad for mix flow)
			if (candidate.isStream) score -= 30;

			// Prefer reasonable duration (1min to 8min)
			const dur = candidate.duration ?? 0;
			if (dur > 60_000 && dur < 480_000) score += 10;

			return score;
		};

		// Helper: filter out history + current/previous, score & rank, return best
		const pickBestTransition = (tracks: Track[]): Track | undefined => {
			const eligible = tracks.filter(
				(t) =>
					t.uri !== previousTrack.uri &&
					t.uri !== track.uri &&
					!historySet.has(t.uri) &&
					!historySet.has(`${t.title}::${t.author}`),
			);
			if (!eligible.length) return undefined;

			const scored = eligible.map((t) => ({ track: t, score: scoreTrack(t) }));
			scored.sort((a, b) => b.score - a.score);

			// Pick from top 3 with slight randomness for variety
			const topN = scored.slice(0, Math.min(3, scored.length));
			const pick = topN[Math.floor(Math.random() * topN.length)];

			this.manager.emit(
				"Debug",
				`[AutoMix] Best candidates: ${scored.slice(0, 5).map((s) => `"${s.track.title}" (${s.score}pts)`).join(", ")}`,
			);

			return pick?.track;
		};

		// Helper: add track to history (bounded ring buffer — dedup by URI and title+author)
		const addToHistory = (t: Track): void => {
			const key = t.uri || `${t.title}::${t.author}`;
			if (key && !historySet.has(key)) {
				player.autoplayHistory.push(key);
				historySet.add(key);
				if (player.autoplayHistory.length > 50) {
					const removed = player.autoplayHistory.splice(0, player.autoplayHistory.length - 50);
					for (const r of removed) historySet.delete(r);
				}
			}
		};

		// Helper: search → score → return best transition
		const tryMixSearch = async (query: string | { source: string; query: string }): Promise<Track | undefined> => {
			try {
				const res = await player.search(query as any, requester);
				if (res.loadType === "empty" || res.loadType === "error") return undefined;
				let tracks = res.tracks;
				if (res.loadType === "playlist" && res.playlist) tracks = res.playlist.tracks;
				return pickBestTransition(tracks);
			} catch {
				return undefined;
			}
		};

		// Helper: commit a found track and play it
		const commitTrack = (found: Track, strategy: string): void => {
			addToHistory(found);
			player.queue.add(found);
			player.play().catch((err) => {
				this.manager.emit(
					"Debug",
					`[AutoMix] Failed to play (${strategy}): ${err instanceof Error ? err.message : String(err)}`,
				);
				player.playing = false;
			});
			this.manager.emit("Debug", `[AutoMix] Playing (${strategy}): "${found.title}" by "${found.author}"`);
		};

		this.manager.emit(
			"Debug",
			`[AutoMix] Finding best transition (from: "${previousTrack.title}" by "${previousTrack.author}", avgDur: ${Math.round(avgDuration / 1000)}s, seeds: ${seedPool.length})`,
		);

		// ── Strategy 1: Spotify Recommendations (multi-seed) ────────────────
		if (this.info?.sourceManagers?.includes("spotify")) {
			try {
				// Build multi-seed from seed pool (up to 5 seed tracks)
				const spotifySeeds = seedPool
					.filter((s) => s.uri?.includes("spotify.com"))
					.map((s) => this.extractSpotifyTrackID(s.uri))
					.filter(Boolean);

				const artistID = previousTrack.pluginInfo?.artistUrl
					? this.extractSpotifyArtistID(previousTrack.pluginInfo.artistUrl)
					: null;

				let identifier = "";
				if (spotifySeeds.length > 0) {
					const seedTracks = spotifySeeds.slice(-3).join(",");
					identifier = artistID
						? `sprec:seed_artists=${artistID}&seed_tracks=${seedTracks}`
						: `sprec:seed_tracks=${seedTracks}`;
				} else if (previousTrack.uri?.includes("spotify.com")) {
					const trackID = this.extractSpotifyTrackID(previousTrack.uri);
					if (trackID) {
						identifier = artistID
							? `sprec:seed_artists=${artistID}&seed_tracks=${trackID}`
							: `sprec:seed_tracks=${trackID}`;
					}
				}

				if (identifier) {
					const recResult = await this.rest.loadTracks(identifier);

					if (recResult.loadType === "playlist") {
						const playlistData = recResult.data as PlaylistRawData;
						const candidates = playlistData.tracks.map((t) => TrackUtils.build(t, requester));
						const picked = pickBestTransition(candidates);
						if (picked) {
							// Try playing the Spotify rec directly first (if source supports it)
							if (picked.track && picked.uri) {
								commitTrack(picked, "Spotify rec (direct)");
								return;
							}
							// Fallback: re-search on SoundCloud for a streamable version
							const streamable = await tryMixSearch({ source: "soundcloud", query: `${picked.author} ${picked.title}` });
							if (streamable) {
								commitTrack(streamable, "Spotify rec → SoundCloud");
								return;
							}
							// Fallback: try YouTube
							const ytFallback = await tryMixSearch({ source: "youtube", query: `${picked.author} ${picked.title}` });
							if (ytFallback) {
								commitTrack(ytFallback, "Spotify rec → YouTube");
								return;
							}
						}
					}
				}
			} catch {
				// Fall through
			}
		}

		// ── Strategy 2: Author-based mix ────────────────────────────────────
		// Build diverse search queries from the seed pool to keep the mix flowing
		if (previousTrack.author) {
			const uniqueAuthors = [...new Set(seedPool.map((s) => s.author).filter(Boolean))];

			// Extract meaningful title keywords (skip noise words) for search context
			const titleKeywords = (previousTrack.title ?? "")
				.split(/[\s\-_()[\],.'"!?]+/)
				.filter((w) => w.length > 2 && !/^(feat|ft|remix|version|official|video|audio|lyrics|mv|hd|hq|high|school|the|and|for)$/i.test(w))
				.slice(0, 3)
				.join(" ");

			// Determine if author name is too short/generic for a standalone search
			// Strip punctuation/symbols to measure actual content length
			const strippedAuthor = previousTrack.author.replace(/[^\p{L}\p{N}]/gu, "");
			const isShortAuthor = strippedAuthor.length <= 5;

			const searchQueries: { source: string; query: string }[] = [];

			// Always try author + title keywords first — most targeted, avoids generic name pollution
			if (titleKeywords) {
				searchQueries.push({ source: "soundcloud", query: `${previousTrack.author} ${titleKeywords}` });
			}
			// Only use bare author name if it's long/unique enough to be a meaningful search term
			if (!isShortAuthor) {
				searchQueries.push({ source: "soundcloud", query: previousTrack.author });
			}
			// Cross-artist from seed pool (also with title context for short names)
			if (uniqueAuthors.length > 1) {
				const altAuthor = uniqueAuthors.find((a) => a !== previousTrack.author);
				if (altAuthor) {
					const altStripped = altAuthor.replace(/[^\p{L}\p{N}]/gu, "");
					if (altStripped.length > 5) {
						searchQueries.push({ source: "soundcloud", query: altAuthor });
					} else if (titleKeywords) {
						searchQueries.push({ source: "soundcloud", query: `${altAuthor} ${titleKeywords}` });
					}
				}
			}
			// YouTube fallback
			searchQueries.push({ source: "youtube", query: `${previousTrack.author} ${titleKeywords || "music"}` });

			for (const sq of searchQueries) {
				const found = await tryMixSearch(sq);
				if (found) {
					commitTrack(found, `author mix on ${sq.source}`);
					return;
				}
			}
		}

		// ── Strategy 3: Title/theme-based mix ───────────────────────────────
		// Extract theme keywords from seed pool for broader but on-theme results
		if (previousTrack.title) {
			const allTitles = seedPool.map((s) => s.title).join(" ");
			const keywords = allTitles
				.toLowerCase()
				.split(/[\s\-_()[\],]+/)
				.filter((w) => w.length > 3)
				.reduce((acc, w) => { acc.set(w, (acc.get(w) ?? 0) + 1); return acc; }, new Map<string, number>());

			// Get the most common theme words from recent tracks
			const themeWords = [...keywords.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 3)
				.map(([w]) => w)
				.join(" ");

			const searchQueries = [
				{ source: "soundcloud", query: `${previousTrack.author} ${previousTrack.title}` },
				{ source: "soundcloud", query: previousTrack.title },
				...(themeWords ? [{ source: "soundcloud", query: themeWords }] : []),
				{ source: "youtube", query: `${previousTrack.title} ${previousTrack.author}` },
			];

			for (const sq of searchQueries) {
				const found = await tryMixSearch(sq);
				if (found) {
					commitTrack(found, `theme mix on ${sq.source}`);
					return;
				}
			}
		}

		// ── Strategy 4: YouTube Radio Mix (last resort) ─────────────────────
		const hasYouTubeURL = ["youtube.com", "youtu.be"].some((url) =>
			previousTrack.uri?.includes(url),
		);
		if (hasYouTubeURL) {
			// Robust YouTube video ID extraction (handles /watch?v=ID, /shorts/ID, youtu.be/ID)
			let videoID: string | null = null;
			try {
				const url = new URL(previousTrack.uri!);
				if (url.hostname === "youtu.be") {
					videoID = url.pathname.slice(1).split("/")[0] || null;
				} else {
					videoID = url.searchParams.get("v") ?? url.pathname.split("/").pop() ?? null;
				}
			} catch {
				// Fallback regex for malformed URIs
				const match = previousTrack.uri?.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
				videoID = match ? match[1] : null;
			}

			if (videoID && videoID.length >= 10) {
				const randomIndex = Math.floor(Math.random() * 23) + 2;
				const mixURI = `https://www.youtube.com/watch?v=${videoID}&list=RD${videoID}&index=${randomIndex}`;
				const found = await tryMixSearch(mixURI);
				if (found) {
					commitTrack(found, "YouTube radio mix");
					return;
				}
			}
		}

		// All strategies exhausted
		this.manager.emit("Debug", `[AutoMix] No suitable transition found, stopping.`);
		player.playing = false;
		this.manager.emit("QueueEnd", player, track, { type: "TrackEndEvent", reason: "finished" } as any);
	}

	private async handleFailedTrack(player: StellaPlayer, track: Track, payload: TrackEndEvent): Promise<void> {
		player.queue.previous = player.queue.current;
		player.queue.current = player.queue.shift() ?? null;

		if (!player.queue.current) {
			await this.queueEnd(player, track, payload);
			return;
		}

		this.manager.emit("TrackEnd", player, track, payload);
		if (this.manager.options.autoPlay) player.play();
	}

	private async handleRepeatedTrack(player: StellaPlayer, track: Track, payload: TrackEndEvent): Promise<void> {
		const { queue, trackRepeat, queueRepeat } = player;
		const { autoPlay } = this.manager.options;

		if (trackRepeat) {
			queue.unshift(queue.current!);
		} else if (queueRepeat) {
			queue.add(queue.current!);
		}

		queue.previous = queue.current;
		queue.current = queue.shift() ?? null;

		this.manager.emit("TrackEnd", player, track, payload);

		if (payload.reason === "stopped" && !(queue.current = queue.shift() ?? null)) {
			await this.queueEnd(player, track, payload);
			return;
		}

		if (autoPlay) player.play();
	}

	private playNextTrack(player: StellaPlayer, track: Track, payload: TrackEndEvent): void {
		player.queue.previous = player.queue.current;
		player.queue.current = player.queue.shift() ?? null;

		this.manager.emit("TrackEnd", player, track, payload);
		if (this.manager.options.autoPlay) player.play();
	}

	protected async queueEnd(player: StellaPlayer, track: Track, payload: TrackEndEvent): Promise<void> {
		player.queue.previous = player.queue.current;
		player.queue.current = null;

		if (!player.isAutoplay) {
			player.playing = false;
			this.manager.emit("QueueEnd", player, track, payload);
			return;
		}

		await this.handleAutoplay(player, track);
	}

	protected trackStuck(player: StellaPlayer, track: Track, payload: TrackStuckEvent): void {
		player.stop();
		this.manager.emit("TrackStuck", player, track, payload);
	}

	protected trackError(
		player: StellaPlayer,
		track: Track | UnresolvedTrack,
		payload: TrackExceptionEvent,
	): void {
		player.stop();
		this.manager.emit("TrackError", player, track, payload);
	}

	protected socketClosed(player: StellaPlayer, payload: WebSocketClosedEvent): void {
		this.manager.emit("SocketClosed", player, payload);

		// Voice rotation / desync codes — recoverable via silent re-identify
		// 4015 = Voice server changed (Discord rotated the voice server)
		// 4000 = Unknown error (often a UDP desync, recoverable)
		const VOICE_RECONNECT_CODES = [4015, 4000];
		if (VOICE_RECONNECT_CODES.includes(payload.code) && player.voiceChannel) {
			this.manager.emit(
				"Debug",
				`[Player:${player.guild}] Voice socket closed with recoverable code ${payload.code} — attempting silent re-identify`,
			);

			player.reconnectVoice().then(() => {
				this.manager.emit("VoiceReconnect", player, payload.code);
				this.manager.emit(
					"Debug",
					`[Player:${player.guild}] Voice re-identified successfully after code ${payload.code}`,
				);
			}).catch((err) => {
				this.manager.emit(
					"Debug",
					`[Player:${player.guild}] Voice re-identify failed: ${err instanceof Error ? err.message : String(err)} — cleaning up`,
				);
				player.voiceReady = false;
				player.connected = false;
				player.playing = false;
				player.state = "DISCONNECTED";
			});
			return;
		}

		// 4014 = Disconnected by Discord (bot was kicked/moved out of voice)
		if (payload.code === 4014) {
			this.manager.emit(
				"Debug",
				`[Player:${player.guild}] Voice socket closed with code 4014 (kicked from voice) — cleaning up player`,
			);
			player.voiceReady = false;
			player.connected = false;
			player.playing = false;
			player.state = "DISCONNECTED";
			return;
		}

		// 4006 = Session no longer valid — try re-identify, fall back to cleanup
		if (payload.code === 4006 && player.voiceChannel) {
			this.manager.emit(
				"Debug",
				`[Player:${player.guild}] Voice session invalidated (4006) — attempting re-identify`,
			);

			player.reconnectVoice().then(() => {
				this.manager.emit("VoiceReconnect", player, payload.code);
				this.manager.emit(
					"Debug",
					`[Player:${player.guild}] Voice re-identified after session invalidation`,
				);
			}).catch(() => {
				this.manager.emit(
					"Debug",
					`[Player:${player.guild}] Voice re-identify failed after 4006 — disconnecting`,
				);
				player.voiceReady = false;
				player.connected = false;
				player.playing = false;
				player.state = "DISCONNECTED";
			});
			return;
		}
	}
}

export { StellaNode };
