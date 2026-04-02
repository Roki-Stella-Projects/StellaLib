/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * Derived from LithiumX — Copyright (c) 2025 Anantix Network (MIT)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 */
import type {
	LoadType,
	NodeOptions,
	PlayerOptions,
	Track,
	UnresolvedTrack,
	TrackData,
	TrackEndEvent,
	TrackExceptionEvent,
	TrackStartEvent,
	TrackStuckEvent,
	VoicePacket,
	VoiceServer,
	VoiceStateUpdate,
	WebSocketClosedEvent,
	SearchPlatform,
	SearchQuery,
	SearchResult,
	LavalinkResponse,
	PlaylistRawData,
	PlaylistData,
	ManagerOptions,
	ManagerEvents,
	Payload,
} from "./Types";
import type { StellaNode } from "./Node";
import type { StellaPlayer } from "./Player";
import { Structure, TrackUtils, Plugin } from "./Utils";
import { LRUCache } from "./LRUCache";
import { TypedEmitter } from "tiny-typed-emitter";
import managerCheck from "../Utils/ManagerCheck";

/**
 * The main hub for interacting with Lavalink using StellaLib.
 */
class StellaManager extends TypedEmitter<ManagerEvents> {
	public static readonly DEFAULT_SOURCES: Record<SearchPlatform, string> = {
		"youtube music": "ytmsearch",
		youtube: "ytsearch",
		spotify: "spsearch",
		jiosaavn: "jssearch",
		soundcloud: "scsearch",
		deezer: "dzsearch",
		tidal: "tdsearch",
		applemusic: "amsearch",
		bandcamp: "bcsearch",
	};

	/** The map of players. */
	public readonly players = new Map<string, StellaPlayer>();
	/** The map of nodes. */
	public readonly nodes = new Map<string, StellaNode>();
	/** The options that were set. */
	public readonly options: ManagerOptions;
	private initiated = false;
	/** The search result LRU cache (bounded, TTL-based). */
	public caches: LRUCache<string, SearchResult>;
	/** Whether the manager is shutting down. */
	private shuttingDown = false;

	/** Returns the nodes sorted by least CPU load. */
	public get leastLoadNode(): Map<string, StellaNode> {
		const sorted = [...this.nodes.entries()]
			.filter(([, node]) => node.connected)
			.sort(([, a], [, b]) => {
				const aload = a.stats.cpu
					? (a.stats.cpu.lavalinkLoad / a.stats.cpu.cores) * 100
					: 0;
				const bload = b.stats.cpu
					? (b.stats.cpu.lavalinkLoad / b.stats.cpu.cores) * 100
					: 0;
				return aload - bload;
			});
		return new Map(sorted);
	}

	/** Returns the nodes sorted by least amount of players. */
	private get leastPlayersNode(): Map<string, StellaNode> {
		const sorted = [...this.nodes.entries()]
			.filter(([, node]) => node.connected)
			.sort(([, a], [, b]) => a.stats.players - b.stats.players);
		return new Map(sorted);
	}

	/** Returns the node with the lowest penalty score (best performance). */
	public get leastPenaltyNode(): StellaNode | undefined {
		const connected = [...this.nodes.values()].filter((n) => n.connected);
		if (!connected.length) return undefined;
		return connected.reduce((best, node) =>
			node.penalties < best.penalties ? node : best,
		);
	}

	/** Returns a node based on priority. */
	private get priorityNode(): StellaNode | undefined {
		const filteredNodes = [...this.nodes.values()].filter(
			(node) => node.connected && (node.options.priority ?? 0) > 0,
		);
		const totalWeight = filteredNodes.reduce(
			(total, node) => total + (node.options.priority ?? 0),
			0,
		);
		const weightedNodes = filteredNodes.map((node) => ({
			node,
			weight: (node.options.priority ?? 0) / totalWeight,
		}));
		const randomNumber = Math.random();
		let cumulativeWeight = 0;

		for (const { node, weight } of weightedNodes) {
			cumulativeWeight += weight;
			if (randomNumber <= cumulativeWeight) return node;
		}

		return this.leastPenaltyNode;
	}

	/** Returns the best node to use based on configuration. */
	public get useableNodes(): StellaNode {
		if (this.options.usePriority) return this.priorityNode!;

		switch (this.options.useNode) {
			case "leastLoad":
				return this.leastLoadNode.values().next().value as StellaNode;
			case "leastPlayers":
				return this.leastPlayersNode.values().next().value as StellaNode;
			default:
				// Default: use penalty-based selection (best overall)
				return this.leastPenaltyNode ?? (this.leastLoadNode.values().next().value as StellaNode);
		}
	}

	/**
	 * Initiates the Manager class.
	 * @param options
	 */
	constructor(options: ManagerOptions) {
		super();

		managerCheck(options);
		Structure.get("Player").init(this);
		Structure.get("Node").init(this);
		TrackUtils.init(this);

		if (options.trackPartial) {
			TrackUtils.setTrackPartial(options.trackPartial);
			delete options.trackPartial;
		}

		this.options = {
			plugins: [],
			nodes: [
				{
					identifier: "default",
					host: "localhost",
					resumeStatus: true,
					resumeTimeout: 60,
				},
			],
			shards: 1,
			autoPlay: true,
			usePriority: false,
			clientName: "StellaLib/0.0.1 (https://github.com/Roki-Stella-Projects/StellaLib)",
			defaultSearchPlatform: "youtube",
			useNode: "leastPlayers",
			caches: { enabled: false, time: 0, maxSize: 200 },
			...options,
		};

		// Initialize LRU cache for search results
		const cacheOpts = this.options.caches;
		this.caches = new LRUCache<string, SearchResult>(
			cacheOpts?.maxSize ?? 200,
			cacheOpts?.enabled ? (cacheOpts.time || 0) : 0,
		);

		if (this.options.plugins) {
			for (const [index, plugin] of this.options.plugins.entries()) {
				if (!(plugin instanceof Plugin))
					throw new RangeError(`Plugin at index ${index} does not extend Plugin.`);
				plugin.load(this);
			}
		}

		if (this.options.nodes) {
			for (const nodeOptions of this.options.nodes) {
				const node = new (Structure.get("Node"))(nodeOptions);
				this.nodes.set(node.options.identifier!, node);
			}
		}

		// Periodic LRU cache pruning (removes expired entries)
		if (cacheOpts?.enabled && cacheOpts.time > 0) {
			setInterval(() => {
				const pruned = this.caches.prune();
				if (pruned > 0) {
					this.emit("Debug", `[Cache] Pruned ${pruned} expired entries (${this.caches.size} remaining)`);
				}
			}, Math.max(cacheOpts.time, 30000));
		}
	}

	/**
	 * Initiates the Manager.
	 * @param clientId
	 */
	public init(clientId?: string): this {
		if (this.initiated) return this;
		if (typeof clientId !== "undefined") this.options.clientId = clientId;
		if (typeof this.options.clientId !== "string")
			throw new Error('"clientId" set is not type of "string"');
		if (!this.options.clientId)
			throw new Error(
				'"clientId" is not set. Pass it in Manager#init() or as an option in the constructor.',
			);

		for (const node of this.nodes.values()) {
			Promise.resolve(node.connect()).catch((err) => {
				this.emit("NodeError", node, err as Error);
			});
		}

		this.initiated = true;
		this.emit("Debug", "[Manager] Initialized");
		return this;
	}

	/**
	 * Searches the enabled sources based off the URL or the `source` property.
	 * @param query
	 * @param requester The user who requested the search.
	 */
	public async search(
		query: string | SearchQuery,
		requester?: string,
	): Promise<SearchResult> {
		const node = this.useableNodes;
		if (!node) throw new Error("No available nodes.");

		if (this.options.caches?.enabled && typeof query === "string") {
			const cached = this.caches.get(query);
			if (cached) return cached;
		}

		const _query: SearchQuery = typeof query === "string" ? { query } : query;
		const rawQuery = _query.query;
		const isURL = /^https?:\/\//.test(rawQuery);

		// Build the list of platforms to try: primary + fallbacks
		const primarySource = (_query.source ?? this.options.defaultSearchPlatform ?? "youtube") as SearchPlatform;
		const platformsToTry: SearchPlatform[] = [primarySource];

		if (!isURL && this.options.searchFallback?.length) {
			for (const fb of this.options.searchFallback) {
				if (fb !== primarySource) platformsToTry.push(fb);
			}
		}

		let lastError: Error | null = null;

		for (const platform of platformsToTry) {
			const prefix = StellaManager.DEFAULT_SOURCES[platform] ?? platform;
			const search = isURL ? rawQuery : `${prefix}:${rawQuery}`;

			try {
				const res = await node.rest.loadTracks(search);

				if (!res) continue;

				// If empty or error, try next fallback
				if (res.loadType === "empty" || res.loadType === "error") {
					if (platformsToTry.length > 1) {
						this.emit(
							"Debug",
							`[Search] "${platform}" returned ${res.loadType} for "${rawQuery}", trying next fallback...`,
						);
					}
					continue;
				}

				let searchData: TrackData[] = [];
				let playlistData: PlaylistRawData | undefined;

				switch (res.loadType) {
					case "search":
						searchData = res.data as TrackData[];
						break;
					case "track":
						searchData = [res.data as unknown as TrackData];
						break;
					case "playlist":
						playlistData = res.data as PlaylistRawData;
						break;
				}

				const tracks = searchData.map((track) => TrackUtils.build(track, requester));
				let playlist: PlaylistData | undefined;

				if (res.loadType === "playlist" && playlistData) {
					playlist = {
						name: playlistData.info.name,
						tracks: playlistData.tracks.map((track) =>
							TrackUtils.build(track, requester),
						),
						duration: playlistData.tracks.reduce(
							(acc, cur) => acc + (cur.info.length || 0),
							0,
						),
					};
				}

				const result: SearchResult = {
					loadType: res.loadType,
					tracks,
					playlist,
				};

				if (this.options.replaceYouTubeCredentials) {
					let tracksToReplace: Track[] = [];
					if (result.loadType === "playlist" && result.playlist) {
						tracksToReplace = result.playlist.tracks;
					} else {
						tracksToReplace = result.tracks;
					}

					for (const track of tracksToReplace) {
						if (isYouTubeURL(track.uri)) {
							track.author = track.author.replace("- Topic", "").trim();
							track.title = track.title.replace("Topic -", "").trim();
						}
						if (track.title.includes("-")) {
							const [author, title] = track.title
								.split("-")
								.map((str: string) => str.trim());
							track.author = author;
							track.title = title;
						}
					}
				}

				if (this.options.caches?.enabled) {
					this.caches.set(search, result);
				}

				if (platform !== primarySource) {
					this.emit(
						"Debug",
						`[Search] Found results via fallback "${platform}" for "${rawQuery}"`,
					);
				}

				return result;
			} catch (err) {
				lastError = err as Error;
				this.emit(
					"Debug",
					`[Search] Error on "${platform}" for "${rawQuery}": ${(err as Error).message}`,
				);
			}
		}

		// All platforms exhausted — return empty result
		return {
			loadType: "empty",
			tracks: [],
			playlist: undefined,
		};

		function isYouTubeURL(uri: string): boolean {
			return uri?.includes("youtube.com") || uri?.includes("youtu.be");
		}
	}

	/**
	 * Returns the available source managers and plugins on a connected node.
	 * Useful for checking which search platforms the Lavalink server supports.
	 */
	public async getAvailableSources(): Promise<{ sourceManagers: string[]; plugins: { name: string; version: string }[] }> {
		const node = this.useableNodes;
		if (!node) throw new Error("No available nodes.");

		if (!node.info) {
			await node.fetchInfo();
		}

		return {
			sourceManagers: node.info?.sourceManagers ?? [],
			plugins: node.info?.plugins ?? [],
		};
	}

	/**
	 * Decodes the base64 encoded tracks and returns a TrackData array.
	 * @param tracks
	 */
	public async decodeTracks(tracks: string[]): Promise<TrackData[]> {
		const node = this.nodes.values().next().value as StellaNode | undefined;
		if (!node) throw new Error("No available nodes.");

		const res = await node.rest.decodeTracks(tracks);
		if (!res) throw new Error("No data returned from query.");
		return res as TrackData[];
	}

	/**
	 * Decodes the base64 encoded track and returns a TrackData.
	 * @param track
	 */
	public async decodeTrack(track: string): Promise<TrackData> {
		const res = await this.decodeTracks([track]);
		return res[0];
	}

	/**
	 * Creates a player or returns one if it already exists.
	 * @param options
	 */
	public create(options: PlayerOptions): StellaPlayer {
		if (this.players.has(options.guild)) {
			return this.players.get(options.guild)!;
		}
		return new (Structure.get("Player"))(options);
	}

	/**
	 * Returns a player or undefined if it does not exist.
	 * @param guild
	 */
	public get(guild: string): StellaPlayer | undefined {
		return this.players.get(guild);
	}

	/**
	 * Destroys a player if it exists.
	 * @param guild
	 */
	public destroy(guild: string): void {
		this.players.delete(guild);
	}

	/**
	 * Creates a node or returns one if it already exists.
	 * @param options
	 */
	public createNode(options: NodeOptions): StellaNode {
		if (this.nodes.has(options.identifier || options.host)) {
			return this.nodes.get(options.identifier || options.host)!;
		}
		return new (Structure.get("Node"))(options);
	}

	/**
	 * Destroys a node if it exists.
	 * @param identifier
	 */
	public destroyNode(identifier: string): void {
		const node = this.nodes.get(identifier);
		if (!node) return;
		node.destroy();
		this.nodes.delete(identifier);
	}

	/**
	 * Sends voice data to the Lavalink server.
	 * Handles both VOICE_STATE_UPDATE and VOICE_SERVER_UPDATE from Discord.
	 * Includes channelId in voice state to satisfy Lavalink v4 requirements.
	 * @param data
	 */
	public async updateVoiceState(
		data: VoicePacket | VoiceServer | VoiceStateUpdate,
	): Promise<void> {
		if (
			"t" in data &&
			!["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE"].includes(data.t!)
		)
			return;

		const update = "d" in data ? data.d : data;
		if (!update || (!("token" in update) && !("session_id" in update))) return;

		const player = this.players.get(
			(update as VoiceServer).guild_id ?? (update as VoiceStateUpdate).guild_id,
		);
		if (!player) return;

		// VOICE_SERVER_UPDATE — contains token & endpoint
		if ("token" in update) {
			player.voiceState.event = update as VoiceServer;

			const {
				sessionId,
				event: { token, endpoint },
			} = player.voiceState;

			// Include channelId in voice state (required by Lavalink v4)
			await player.node.rest
				.updatePlayer({
					guildId: player.guild,
					data: {
						voice: {
							token,
							endpoint,
							sessionId: sessionId!,
							channelId: player.voiceChannel ?? undefined,
						},
					},
				})
				.then(() => {
					player.resolveVoiceReady();
					this.emit(
						"Debug",
						`[Player:${player.guild}] Voice state flushed to Lavalink`,
					);
				})
				.catch((err) => {
					this.emit(
						"NodeError",
						player.node,
						err instanceof Error ? err : new Error(String(err)),
					);
				});

			return;
		}

		// VOICE_STATE_UPDATE — contains session_id & channel_id
		const voiceUpdate = update as VoiceStateUpdate;
		if (voiceUpdate.user_id !== this.options.clientId) return;

		if (voiceUpdate.channel_id) {
			if (player.voiceChannel !== voiceUpdate.channel_id) {
				this.emit(
					"PlayerMove",
					player,
					player.voiceChannel!,
					voiceUpdate.channel_id,
				);
			}

			player.voiceState.sessionId = voiceUpdate.session_id;
			player.voiceState.channelId = voiceUpdate.channel_id;
			player.voiceChannel = voiceUpdate.channel_id;
			return;
		}

		// Channel is null — user disconnected
		this.emit("PlayerDisconnect", player, player.voiceChannel!);
		player.voiceChannel = null;
		player.voiceState = Object.assign({
			op: "voiceUpdate" as const,
			guildId: player.guild,
		});
		player.destroy();
	}

	/**
	 * Gracefully shuts down the Manager: persists sessions, closes all nodes, and cleans up.
	 * Call this before your bot exits to enable seamless session resume on restart.
	 *
	 * Usage:
	 * ```ts
	 * process.on("SIGINT", async () => {
	 *   await manager.shutdown();
	 *   process.exit(0);
	 * });
	 * ```
	 */
	public async shutdown(): Promise<void> {
		if (this.shuttingDown) return;
		this.shuttingDown = true;

		this.emit("Debug", "[Manager] Graceful shutdown initiated...");

		// Gracefully close all nodes (persists session IDs for resume)
		const closePromises: Promise<void>[] = [];
		for (const node of this.nodes.values()) {
			closePromises.push(node.gracefulClose());
		}
		await Promise.allSettled(closePromises);

		// Flush session store if it supports it
		const store = this.options.sessionStore;
		if (store && "destroy" in store && typeof (store as any).destroy === "function") {
			try {
				(store as any).destroy();
			} catch {
				// Ignore
			}
		}

		// Clear caches
		this.caches.clear();

		this.emit("Debug", `[Manager] Shutdown complete. ${this.nodes.size} nodes closed, sessions persisted.`);
	}

	/**
	 * Returns memory and performance statistics for monitoring.
	 */
	public getStats(): {
		nodes: { identifier: string; connected: boolean; players: number; playingPlayers: number; penalties: number; uptime: number; memory: { used: number; free: number; allocated: number }; restRequests: number; restFailed: number }[];
		totalPlayers: number;
		totalPlayingPlayers: number;
		cacheSize: number;
		cacheMemoryEstimate: number;
	} {
		const nodes = [...this.nodes.values()].map((node) => ({
			identifier: node.options.identifier!,
			connected: node.connected,
			players: node.stats.players,
			playingPlayers: node.stats.playingPlayers,
			penalties: node.penalties,
			uptime: node.uptime,
			memory: {
				used: node.stats.memory.used,
				free: node.stats.memory.free,
				allocated: node.stats.memory.allocated,
			},
			restRequests: node.rest.requestCount,
			restFailed: node.rest.failedCount,
		}));

		return {
			nodes,
			totalPlayers: this.players.size,
			totalPlayingPlayers: [...this.players.values()].filter((p) => p.playing).length,
			cacheSize: this.caches.size,
			cacheMemoryEstimate: this.caches.memoryEstimate,
		};
	}
}

export { StellaManager };
