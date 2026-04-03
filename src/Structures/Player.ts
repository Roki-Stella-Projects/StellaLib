/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * Derived from LithiumX — Copyright (c) 2025 Anantix Network (MIT)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 */
import type {
	LavalinkInfo,
	LavalinkResponse,
	NodeOptions,
	PlaylistRawData,
	SearchQuery,
	SearchResult,
	Sizes,
	State,
	TrackSourceName,
	VoiceState,
	PlayerOptions,
	Track,
	UnresolvedTrack,
	PlayOptions,
	EqualizerBand,
	TrackPluginInfo,
	PlayerStateSnapshot,
	PlayerPersistData,
	TrackPersistData,
	SponsorBlockCategory,
	SponsorBlockSegment,
	CrossfadeOptions,
} from "./Types";
import type { StellaManager } from "./Manager";
import type { StellaNode } from "./Node";
import { Filters } from "./Filters";
import { StellaQueue } from "./Queue";
import { Structure, TrackUtils } from "./Utils";
import playerCheck from "../Utils/PlayerCheck";

export class StellaPlayer {
	/** The Queue for the Player. */
	public readonly queue = new (Structure.get("Queue"))() as StellaQueue;
	/** The filters applied to the audio. */
	public filters: Filters;
	/** Whether the queue repeats the track. */
	public trackRepeat = false;
	/** Whether the queue repeats the queue. */
	public queueRepeat = false;
	/** Whether the queue repeats and shuffles after each song. */
	public dynamicRepeat = false;
	/** The time the player is in the track. */
	public position = 0;
	/** Whether the player is playing. */
	public playing = false;
	/** Whether the player is paused. */
	public paused = false;
	/** The volume for the player. */
	public volume: number;
	/** The Node for the Player. */
	public node: StellaNode;
	/** The guild for the player. */
	public guild: string;
	/** The voice channel for the player. */
	public voiceChannel: string | null = null;
	/** The text channel for the player. */
	public textChannel: string | null = null;
	/** The current state of the player. */
	public state: State = "DISCONNECTED";
	/** The equalizer bands array. */
	public bands = new Array<number>(15).fill(0.0);
	/** The voice state object from Discord. */
	public voiceState: VoiceState;
	/** The Manager. */
	public manager: StellaManager;
	/** The autoplay state of the player. */
	public isAutoplay = false;
	/** History of recently auto-played track URIs (avoids repeats). */
	public autoplayHistory: string[] = [];
	/** Max autoplay history size before it rotates. */
	public static readonly AUTOPLAY_HISTORY_MAX = 50;
	/** Seed pool: last N tracks used for multi-seed smart mix recommendations. */
	public autoplaySeedPool: { title: string; author: string; uri: string; duration: number; sourceName: string }[] = [];
	/** Max seed pool size. */
	public static readonly SEED_POOL_MAX = 5;
	/** Anchor track: the first track that started the current autoplay session. Used to prevent style drift. */
	public autoplayAnchor: { title: string; author: string; uri: string; duration: number; sourceName: string } | null = null;
	/** Whether the voice connection is ready. */
	public connected = false;
	/** The ping to the voice server in ms. */
	public ping = -1;

	/** Inactivity timeout in ms (0 = disabled). Auto-disconnect when alone in VC. */
	public inactivityTimeout: number;
	/** Maximum queue size (0 = unlimited). */
	public maxQueueSize: number;

	private static _manager: StellaManager;
	private readonly data: Record<string, unknown> = {};
	private dynamicLoopInterval?: ReturnType<typeof setInterval>;
	/** Timer for inactivity auto-disconnect. */
	private inactivityTimer?: ReturnType<typeof setTimeout>;

	/** Whether the voice connection handshake is complete. */
	public voiceReady = false;
	/** @hidden */
	public voiceReadyResolvers: Array<() => void> = [];

	/** Active SponsorBlock categories for this player. */
	private sponsorBlockCategories: SponsorBlockCategory[] = [];

	/** Crossfade configuration. */
	private crossfadeOptions: CrossfadeOptions = { duration: 0 };
	/** Crossfade interval timer. */
	private crossfadeTimer?: ReturnType<typeof setInterval>;
	/** Whether auto-ducking is active. */
	private autoDuckActive = false;
	/** Volume before ducking was applied. */
	private preDuckVolume = 0;

	/**
	 * Set custom data.
	 * @param key
	 * @param value
	 */
	public set(key: string, value: unknown): void {
		this.data[key] = value;
	}

	/**
	 * Get custom data.
	 * @param key
	 */
	public get<T>(key: string): T {
		return this.data[key] as T;
	}

	/** @hidden */
	public static init(manager: StellaManager): void {
		this._manager = manager;
	}

	/**
	 * Creates a new player, returns one if it already exists.
	 * @param options
	 */
	constructor(public options: PlayerOptions) {
		if (!this.manager) this.manager = Structure.get("Player")._manager;
		if (!this.manager) throw new RangeError("Manager has not been initiated.");

		if (this.manager.players.has(options.guild))
			return this.manager.players.get(options.guild)!;

		playerCheck(options);

		this.guild = options.guild;
		this.voiceState = Object.assign({
			op: "voiceUpdate" as const,
			guildId: options.guild,
		});

		if (options.voiceChannel) this.voiceChannel = options.voiceChannel;
		if (options.textChannel) this.textChannel = options.textChannel;

		const node = this.manager.nodes.get(options.node!);
		this.node = node || this.manager.useableNodes;

		if (!this.node) throw new RangeError("No available nodes.");

		this.inactivityTimeout = options.inactivityTimeout ?? 0;
		this.maxQueueSize = options.maxQueueSize ?? 0;

		this.manager.players.set(options.guild, this);
		this.manager.emit("PlayerCreate", this);
		this.setVolume(options.volume ?? 11);
		this.filters = new Filters(this);
	}

	/**
	 * Same as Manager#search() but a shortcut on the player itself.
	 * @param query The query to search.
	 * @param requester The user who requested the search.
	 */
	public search(query: string | SearchQuery, requester?: string): Promise<SearchResult> {
		return this.manager.search(query, requester);
	}

	/** Connect to the voice channel. */
	public connect(): this {
		if (!this.voiceChannel) throw new RangeError("No voice channel has been set.");
		this.state = "CONNECTING";

		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] Connecting to voice channel ${this.voiceChannel}`,
		);

		this.manager.options.send(this.guild, {
			op: 4,
			d: {
				guild_id: this.guild,
				channel_id: this.voiceChannel,
				self_mute: this.options.selfMute || false,
				self_deaf: this.options.selfDeafen || false,
			},
		});

		this.state = "CONNECTED";
		return this;
	}

	/**
	 * Waits for the voice connection to be ready before playing.
	 * @param timeout Timeout in ms (default: 15000).
	 */
	public waitForVoice(timeout = 15000): Promise<void> {
		if (this.voiceReady) return Promise.resolve();

		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] Waiting for voice connection before playing...`,
		);

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this.voiceReadyResolvers.indexOf(resolve);
				if (idx !== -1) this.voiceReadyResolvers.splice(idx, 1);
				reject(new Error("Voice connection timed out"));
			}, timeout);

			this.voiceReadyResolvers.push(() => {
				clearTimeout(timer);
				resolve();
			});
		});
	}

	/**
	 * Moves the player to a different node.
	 * @param node The ID of the node to move to.
	 */
	public async moveNode(node?: string): Promise<this> {
		const targetId =
			node ||
			this.manager.leastLoadNode.values().next().value?.options.identifier ||
			[...this.manager.nodes.values()].find((n: StellaNode) => n.connected)?.options.identifier;

		if (!targetId || !this.manager.nodes.has(targetId))
			throw new RangeError("No nodes available.");
		if (this.node.options.identifier === targetId) return this;

		// Clean up dynamic repeat interval during move
		if (this.dynamicLoopInterval) {
			clearInterval(this.dynamicLoopInterval);
			this.dynamicLoopInterval = undefined;
		}

		const currentNode = this.node;
		const destinationNode = this.manager.nodes.get(targetId)!;
		let position = this.position;

		// Try to fetch accurate position from source node (may be dead during failover)
		if (currentNode.connected) {
			try {
				const fetchedPlayer = (await currentNode.rest.getPlayer(this.guild)
				) as { track?: { info?: { position?: number } } } | null;
				position = fetchedPlayer?.track?.info?.position ?? this.position;
			} catch {
				// Use local position — source node may be dead
			}
		}

		this.state = "MOVING";

		// Send voice connection first so Lavalink can join the voice channel
		if (this.voiceState?.sessionId && this.voiceState?.event) {
			await destinationNode.rest.updatePlayer({
				guildId: this.guild,
				data: {
					voice: {
						token: this.voiceState.event.token,
						endpoint: this.voiceState.event.endpoint,
						sessionId: this.voiceState.sessionId,
						channelId: this.voiceChannel ?? undefined,
					},
				},
			});
		}

		// Now send track + position + volume + filters to resume playback
		await destinationNode.rest.updatePlayer({
			guildId: this.guild,
			data: {
				encodedTrack: this.queue.current?.track,
				position,
				volume: this.volume,
				paused: this.paused,
				filters: {
					distortion: this.filters.distortion,
					equalizer: this.filters.equalizer,
					karaoke: this.filters.karaoke,
					rotation: this.filters.rotation,
					timescale: this.filters.timescale,
					vibrato: this.filters.vibrato,
					volume: this.filters.volume,
				},
			},
		});

		// Switch node reference
		const oldNodeId = currentNode.options.identifier!;
		this.node = destinationNode;

		// Destroy player on old node (best-effort, may be dead)
		if (currentNode.connected) {
			currentNode.rest.destroyPlayer(this.guild).catch(() => {});
		}

		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] Moved from ${oldNodeId} → ${destinationNode.options.identifier} (pos: ${position}ms)`,
		);

		setTimeout(() => {
			if (this.state === "MOVING") this.state = "CONNECTED";
		}, 5000);

		return this;
	}

	/** Disconnect from the voice channel. */
	public disconnect(): this {
		if (this.voiceChannel === null) return this;
		this.state = "DISCONNECTING";

		// Clean up dynamic repeat interval
		if (this.dynamicLoopInterval) {
			clearInterval(this.dynamicLoopInterval);
			this.dynamicLoopInterval = undefined;
		}

		this.pause(true);
		this.manager.options.send(this.guild, {
			op: 4,
			d: {
				guild_id: this.guild,
				channel_id: null,
				self_mute: false,
				self_deaf: false,
			},
		});

		this.voiceChannel = null;
		this.voiceReady = false;
		this.state = "DISCONNECTED";
		return this;
	}

	/**
	 * Silently re-identifies the voice connection without clearing the queue or filters.
	 * Used for "hot-swapping" when Discord rotates voice servers (code 4015/4000).
	 * The user hears a ~1s gap, then music resumes automatically.
	 */
	public async reconnectVoice(): Promise<void> {
		if (!this.voiceChannel) throw new Error("No voice channel to reconnect to.");

		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] Voice hot-swap: re-identifying to ${this.voiceChannel}`,
		);

		this.voiceReady = false;
		this.state = "CONNECTING";

		// Re-send the voice state to Discord to get a fresh token/endpoint
		this.manager.options.send(this.guild, {
			op: 4,
			d: {
				guild_id: this.guild,
				channel_id: this.voiceChannel,
				self_mute: this.options.selfMute || false,
				self_deaf: this.options.selfDeafen || false,
			},
		});

		// Wait for voice to be ready again (Discord will send new VOICE_STATE_UPDATE + VOICE_SERVER_UPDATE)
		await this.waitForVoice(10000);

		// Resume playback at the current position
		if (this.queue.current && this.playing) {
			const resumePosition = this.position;
			await this.node.rest.updatePlayer({
				guildId: this.guild,
				data: {
					encodedTrack: this.queue.current.track,
					position: resumePosition,
					volume: this.volume,
					paused: this.paused,
				},
			});

			this.manager.emit(
				"Debug",
				`[Player:${this.guild}] Voice hot-swap: resumed at ${resumePosition}ms`,
			);
		}

		this.state = "CONNECTED";
	}

	/** Destroys the player, cleaning up all timers and resources. */
	public destroy(disconnect = true): void {
		this.state = "DESTROYING";

		// Clean up dynamic repeat interval
		if (this.dynamicLoopInterval) {
			clearInterval(this.dynamicLoopInterval);
			this.dynamicLoopInterval = undefined;
		}

		// Clean up inactivity timer
		this.stopInactivityTimer();

		// Clear pending voice resolvers
		this.voiceReadyResolvers = [];
		this.voiceReady = false;

		if (disconnect) this.disconnect();

		this.node.rest.destroyPlayer(this.guild).catch(() => {});

		// Delete persisted player state so it doesn't resurrect on next restart
		const store = this.manager.getPlayerStateStore();
		if (store) {
			Promise.resolve(store.deletePlayerState(this.guild)).catch(() => {});
		}

		this.manager.emit("PlayerDestroy", this);
		this.manager.players.delete(this.guild);
	}

	/**
	 * Sets the player voice channel.
	 * @param channel
	 */
	public setVoiceChannel(channel: string): this {
		if (typeof channel !== "string") throw new TypeError("Channel must be a non-empty string.");
		this.voiceChannel = channel;
		this.connect();
		return this;
	}

	/**
	 * Sets the player text channel.
	 * @param channel
	 */
	public setTextChannel(channel: string): this {
		if (typeof channel !== "string") throw new TypeError("Channel must be a non-empty string.");
		this.textChannel = channel;
		return this;
	}

	/** Plays the next track. */
	public async play(): Promise<void>;
	/** Plays the specified track. */
	public async play(track: Track | UnresolvedTrack): Promise<void>;
	/** Plays the next track with some options. */
	public async play(options: PlayOptions): Promise<void>;
	/** Plays the specified track with some options. */
	public async play(track: Track | UnresolvedTrack, options: PlayOptions): Promise<void>;
	public async play(
		optionsOrTrack?: PlayOptions | Track | UnresolvedTrack,
		playOptions?: PlayOptions,
	): Promise<void> {
		if (typeof optionsOrTrack !== "undefined" && TrackUtils.validate(optionsOrTrack)) {
			if (this.queue.current) this.queue.previous = this.queue.current;
			this.queue.current = optionsOrTrack as Track;
		}

		if (!this.queue.current) throw new RangeError("No current track.");

		const finalOptions = playOptions
			? playOptions
			: ["startTime", "endTime", "noReplace"].every((v) =>
					Object.keys(optionsOrTrack || {}).includes(v),
				)
				? (optionsOrTrack as PlayOptions)
				: {};

		if (TrackUtils.isUnresolvedTrack(this.queue.current)) {
			try {
				this.queue.current = await TrackUtils.getClosestTrack(
					this.queue.current as UnresolvedTrack,
				);
			} catch (error) {
				this.manager.emit("TrackError", this, this.queue.current, error);
				if (this.queue[0]) return this.play(this.queue[0]);
				return;
			}
		}

		// Wait for voice connection to be ready before playing
		if (!this.voiceReady) {
			await this.waitForVoice();
		}

		await this.node.rest.updatePlayer({
			guildId: this.guild,
			data: {
				encodedTrack: this.queue.current?.track,
				...finalOptions,
			},
		});

		Object.assign(this, { position: 0, playing: true });
	}

	/**
	 * Sets the autoplay state of the player.
	 * @param autoplayState
	 * @param botUser
	 */
	public setAutoplay(autoplayState: boolean, botUser: object): this {
		if (typeof autoplayState !== "boolean")
			throw new TypeError("autoplayState must be a boolean.");
		if (typeof botUser !== "object") throw new TypeError("botUser must be a user-object.");
		this.isAutoplay = autoplayState;
		this.set("Internal_BotUser", botUser);
		if (!autoplayState) {
			this.autoplayAnchor = null;
			this.autoplaySeedPool = [];
			this.autoplayHistory = [];
		}
		return this;
	}

	/**
	 * Gets recommended tracks and returns an array of tracks.
	 * @param track
	 * @param requester
	 */
	public async getRecommended(track: Track, requester?: string): Promise<Track[] | undefined> {
		const node = this.manager.useableNodes;
		if (!node) throw new Error("No available nodes.");

		const hasSpotifyURL = ["spotify.com", "open.spotify.com"].some((url) =>
			track.uri?.includes(url),
		);
		const hasYouTubeURL = ["youtube.com", "youtu.be"].some((url) =>
			track.uri?.includes(url),
		);

		if (hasSpotifyURL) {
			try {
				const info = await node.rest.getInfo();
				const isSpotifyPluginEnabled = info.plugins?.some(
					(plugin: { name: string }) => plugin.name === "lavasrc-plugin",
				);
				const isSpotifySourceManagerEnabled = info.sourceManagers?.includes("spotify");

				if (isSpotifyPluginEnabled && isSpotifySourceManagerEnabled) {
					const trackID = node.extractSpotifyTrackID(track.uri);
					const artistID = track.pluginInfo?.artistUrl
						? node.extractSpotifyArtistID(track.pluginInfo.artistUrl)
						: null;

					let identifier = "";
					if (trackID && artistID) identifier = `sprec:seed_artists=${artistID}&seed_tracks=${trackID}`;
					else if (trackID) identifier = `sprec:seed_tracks=${trackID}`;
					else if (artistID) identifier = `sprec:seed_artists=${artistID}`;

					if (identifier) {
						const recommendedResult = await node.rest.loadTracks(identifier);

						if (recommendedResult.loadType === "playlist") {
							const playlistData = recommendedResult.data as PlaylistRawData;
							if (playlistData.tracks)
								return playlistData.tracks.map((t) => TrackUtils.build(t, requester));
						}
					}
				}
			} catch {
				// Fall through
			}
		}

		let videoID = track.uri?.substring(track.uri.indexOf("=") + 1);
		if (!hasYouTubeURL) {
			const res = await this.manager.search(`${track.author} - ${track.title}`);
			videoID = res.tracks[0]?.uri?.substring(res.tracks[0].uri.indexOf("=") + 1);
		}

		if (!videoID) return undefined;

		const searchURI = `https://www.youtube.com/watch?v=${videoID}&list=RD${videoID}`;
		const res = await this.manager.search(searchURI);
		if (res.loadType === "empty" || res.loadType === "error") return undefined;

		let tracks = res.tracks;
		if (res.loadType === "playlist") tracks = res.playlist?.tracks ?? [];

		const filteredTracks = tracks.filter(
			(t) => t.uri !== `https://www.youtube.com/watch?v=${videoID}`,
		);

		if (this.manager.options.replaceYouTubeCredentials) {
			for (const t of filteredTracks) {
				t.author = t.author.replace("- Topic", "").trim();
				t.title = t.title.replace("Topic -", "").trim();
				if (t.title.includes("-")) {
					const [author, title] = t.title.split("-").map((s: string) => s.trim());
					t.author = author;
					t.title = title;
				}
			}
		}

		return filteredTracks;
	}

	/**
	 * Sets the player volume.
	 * @param volume
	 */
	public async setVolume(volume: number): Promise<this> {
		if (isNaN(volume)) throw new TypeError("Volume must be a number.");
		await this.node.rest.updatePlayer({
			guildId: this.options.guild,
			data: { volume },
		});
		this.volume = volume;
		return this;
	}

	/**
	 * Sets the track repeat.
	 * @param repeat
	 */
	public setTrackRepeat(repeat: boolean): this {
		if (typeof repeat !== "boolean")
			throw new TypeError('Repeat can only be "true" or "false".');
		const oldPlayer = { ...this };
		this.trackRepeat = repeat;
		this.queueRepeat = false;
		this.dynamicRepeat = false;
		this.manager.emit("PlayerStateUpdate", oldPlayer as StellaPlayer, this);
		return this;
	}

	/**
	 * Sets the queue repeat.
	 * @param repeat
	 */
	public setQueueRepeat(repeat: boolean): this {
		if (typeof repeat !== "boolean")
			throw new TypeError('Repeat can only be "true" or "false".');
		const oldPlayer = { ...this };
		this.trackRepeat = false;
		this.queueRepeat = repeat;
		this.dynamicRepeat = false;
		this.manager.emit("PlayerStateUpdate", oldPlayer as StellaPlayer, this);
		return this;
	}

	/**
	 * Sets the queue to repeat and shuffles the queue after each song.
	 * @param repeat Whether to enable dynamic repeat.
	 * @param ms After how many milliseconds to trigger dynamic repeat.
	 */
	public setDynamicRepeat(repeat: boolean, ms: number): this {
		if (typeof repeat !== "boolean")
			throw new TypeError('Repeat can only be "true" or "false".');
		if (this.queue.size <= 1)
			throw new RangeError("The queue size must be greater than 1.");

		const oldPlayer = { ...this };

		if (repeat) {
			this.trackRepeat = false;
			this.queueRepeat = false;
			this.dynamicRepeat = true;
			this.dynamicLoopInterval = setInterval(() => {
				if (!this.dynamicRepeat) return;
				const shuffled = [...this.queue].sort(() => Math.random() - 0.5);
				this.queue.clear();
				shuffled.forEach((track) => this.queue.add(track));
			}, ms);
		} else {
			if (this.dynamicLoopInterval) clearInterval(this.dynamicLoopInterval);
			this.trackRepeat = false;
			this.queueRepeat = false;
			this.dynamicRepeat = false;
		}

		this.manager.emit("PlayerStateUpdate", oldPlayer as StellaPlayer, this);
		return this;
	}

	/** Restarts the current track to the start. */
	public async restart(): Promise<void> {
		if (!this.queue.current?.track) {
			if (this.queue.length) this.play();
			return;
		}
		await this.node.rest.updatePlayer({
			guildId: this.guild,
			data: { position: 0, encodedTrack: this.queue.current?.track },
		});
	}

	/** Stops the current track, optionally give an amount to skip to. */
	public async stop(amount?: number): Promise<this> {
		if (typeof amount === "number" && amount > 1) {
			if (amount > this.queue.length)
				throw new RangeError("Cannot skip more than the queue length.");
			this.queue.splice(0, amount - 1);
		}

		await this.node.rest.updatePlayer({
			guildId: this.guild,
			data: { encodedTrack: null },
		});

		return this;
	}

	/**
	 * Pauses the current track.
	 * @param pause
	 */
	public async pause(pause: boolean): Promise<this> {
		if (typeof pause !== "boolean")
			throw new RangeError('Pause can only be "true" or "false".');
		if (this.paused === pause || !this.queue.totalSize) return this;

		const oldPlayer = { ...this };
		this.playing = !pause;
		this.paused = pause;

		await this.node.rest.updatePlayer({
			guildId: this.guild,
			data: { paused: pause },
		});

		this.manager.emit("PlayerStateUpdate", oldPlayer as StellaPlayer, this);
		return this;
	}

	/** Go back to the previous song. */
	public previous(): this {
		if (this.queue.previous) {
			this.queue.unshift(this.queue.previous);
		}
		this.stop();
		return this;
	}

	/**
	 * Seeks to the position in the current track.
	 * @param position
	 */
	public async seek(position: number): Promise<this | undefined> {
		if (!this.queue.current) return undefined;
		position = Number(position);

		if (isNaN(position)) throw new RangeError("Position must be a number.");
		if (position < 0 || position > this.queue.current.duration!)
			position = Math.max(Math.min(position, this.queue.current.duration!), 0);

		this.position = position;

		await this.node.rest.updatePlayer({
			guildId: this.guild,
			data: { position },
		});

		return this;
	}

	/**
	 * Called internally when voice state is flushed to Lavalink.
	 * Resolves all pending waitForVoice() callers.
	 */
	public resolveVoiceReady(): void {
		this.voiceReady = true;
		this.connected = true;
		const resolvers = this.voiceReadyResolvers;
		this.voiceReadyResolvers = [];
		for (const resolve of resolvers) resolve();
	}

	// ── Inactivity Timer ──────────────────────────────────────────────────

	/**
	 * Starts the inactivity timer. When it fires, the player auto-disconnects.
	 * Call this when the bot detects it's alone in the voice channel.
	 */
	public startInactivityTimer(): void {
		if (!this.inactivityTimeout || this.inactivityTimeout <= 0) return;
		this.stopInactivityTimer();

		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] Alone in voice channel — auto-disconnect in ${this.inactivityTimeout}ms`,
		);

		this.inactivityTimer = setTimeout(() => {
			this.manager.emit(
				"Debug",
				`[Player:${this.guild}] Inactivity timeout reached — destroying player`,
			);
			this.destroy();
		}, this.inactivityTimeout);
	}

	/** Stops the inactivity timer (e.g., when someone joins the voice channel). */
	public stopInactivityTimer(): void {
		if (this.inactivityTimer) {
			clearTimeout(this.inactivityTimer);
			this.inactivityTimer = undefined;
		}
	}

	// ── Queue Size Enforcement ────────────────────────────────────────────

	/**
	 * Checks if the queue can accept more tracks.
	 * @param count Number of tracks to add (default 1).
	 * @returns true if the queue has room, false otherwise.
	 */
	public canAddToQueue(count = 1): boolean {
		if (!this.maxQueueSize || this.maxQueueSize <= 0) return true;
		return this.queue.length + count <= this.maxQueueSize;
	}

	/**
	 * Returns how many more tracks can be added to the queue.
	 * Returns Infinity if no limit is set.
	 */
	public get queueSpaceRemaining(): number {
		if (!this.maxQueueSize || this.maxQueueSize <= 0) return Infinity;
		return Math.max(0, this.maxQueueSize - this.queue.length);
	}

	// ── SponsorBlock Integration ─────────────────────────────────────────

	/**
	 * Sets SponsorBlock categories to auto-skip for this player.
	 * Requires the SponsorBlock Lavalink plugin.
	 *
	 * @param categories The categories to skip (e.g., ["sponsor", "selfpromo", "intro"]).
	 * @example
	 * ```ts
	 * player.setSponsorBlock(["sponsor", "selfpromo", "interaction"]);
	 * ```
	 */
	public async setSponsorBlock(categories: SponsorBlockCategory[]): Promise<void> {
		await this.node.rest.setSponsorBlock(this.guild, categories);
		this.sponsorBlockCategories = [...categories];
		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] SponsorBlock categories set: ${categories.join(", ")}`,
		);
	}

	/**
	 * Gets the current SponsorBlock categories for this player.
	 * @returns The active SponsorBlock segments from the server.
	 */
	public async getSponsorBlock(): Promise<SponsorBlockSegment[]> {
		return await this.node.rest.getSponsorBlock(this.guild);
	}

	/**
	 * Removes all SponsorBlock categories from this player.
	 */
	public async clearSponsorBlock(): Promise<void> {
		await this.node.rest.deleteSponsorBlock(this.guild);
		this.sponsorBlockCategories = [];
		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] SponsorBlock categories cleared`,
		);
	}

	/**
	 * Returns the locally-cached SponsorBlock categories.
	 * Does not make a REST call — use getSponsorBlock() for live data.
	 */
	public get sponsorBlock(): SponsorBlockCategory[] {
		return [...this.sponsorBlockCategories];
	}

	// ── Crossfade Emulation ──────────────────────────────────────────────

	/**
	 * Sets the crossfade duration for track transitions.
	 * When enabled, the current track's volume fades out over the specified duration
	 * before the next track starts, creating a smooth audio transition.
	 *
	 * @param durationMs Crossfade duration in milliseconds (0 = disabled).
	 * @example
	 * ```ts
	 * player.setCrossfade(5000); // 5-second crossfade
	 * player.setCrossfade(0);    // Disable crossfade
	 * ```
	 */
	public setCrossfade(durationMs: number): void {
		if (durationMs < 0) throw new RangeError("Crossfade duration must be >= 0.");
		this.crossfadeOptions = { duration: durationMs };
		this.clearCrossfadeTimer();

		if (durationMs > 0) {
			this.startCrossfadeMonitor();
		}

		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] Crossfade set to ${durationMs}ms`,
		);
	}

	/** Returns the current crossfade duration in ms. */
	public get crossfadeDuration(): number {
		return this.crossfadeOptions.duration;
	}

	/**
	 * Monitors track position and triggers volume fade-out when approaching track end.
	 * @hidden
	 */
	private startCrossfadeMonitor(): void {
		this.clearCrossfadeTimer();
		if (this.crossfadeOptions.duration <= 0) return;

		this.crossfadeTimer = setInterval(() => {
			if (!this.playing || !this.queue.current) {
				this.clearCrossfadeTimer();
				return;
			}

			const trackDuration = this.queue.current.duration ?? 0;
			if (trackDuration <= 0 || this.queue.current.isStream) return;

			const remaining = trackDuration - this.position;
			const fadeDuration = this.crossfadeOptions.duration;

			if (remaining <= fadeDuration && remaining > 0 && this.queue.length > 0) {
				this.clearCrossfadeTimer();
				this.executeCrossfade(remaining);
			}
		}, 500);
	}

	/**
	 * Executes the crossfade by gradually reducing volume.
	 * @hidden
	 */
	private executeCrossfade(remainingMs: number): void {
		const originalVolume = this.volume;
		const steps = Math.max(5, Math.floor(remainingMs / 200));
		const volumeStep = originalVolume / steps;
		let currentStep = 0;

		const nextTrack = this.queue[0];
		if (nextTrack) {
			this.manager.emit("CrossfadeStart", this, this.queue.current as Track, nextTrack);
		}

		const fadeInterval = setInterval(() => {
			currentStep++;
			const newVolume = Math.max(0, Math.round(originalVolume - (volumeStep * currentStep)));

			this.node.rest.updatePlayer({
				guildId: this.guild,
				data: { volume: newVolume },
			}).catch(() => {});

			if (currentStep >= steps) {
				clearInterval(fadeInterval);
				// Restore volume for next track (will be applied on TrackStart)
				this.volume = originalVolume;
			}
		}, Math.floor(remainingMs / steps));
	}

	/** Clears the crossfade monitor timer. @hidden */
	private clearCrossfadeTimer(): void {
		if (this.crossfadeTimer) {
			clearInterval(this.crossfadeTimer);
			this.crossfadeTimer = undefined;
		}
	}

	// ── Auto-Ducking ─────────────────────────────────────────────────────

	/**
	 * Enables auto-ducking: reduces music volume temporarily.
	 * Useful when TTS or voice announcements play over music.
	 *
	 * @param duckVolume The volume to duck to (0-100, default: 20).
	 * @example
	 * ```ts
	 * player.duck(20);        // Duck to 20% volume
	 * // ... TTS plays ...
	 * player.unduck();         // Restore original volume
	 * ```
	 */
	public async duck(duckVolume = 20): Promise<void> {
		if (this.autoDuckActive) return;
		this.preDuckVolume = this.volume;
		this.autoDuckActive = true;
		await this.node.rest.updatePlayer({
			guildId: this.guild,
			data: { volume: duckVolume },
		});
		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] Auto-ducking: ${this.preDuckVolume} → ${duckVolume}`,
		);
	}

	/**
	 * Restores volume after auto-ducking.
	 */
	public async unduck(): Promise<void> {
		if (!this.autoDuckActive) return;
		this.autoDuckActive = false;
		const restoreVolume = this.preDuckVolume || this.volume;
		await this.node.rest.updatePlayer({
			guildId: this.guild,
			data: { volume: restoreVolume },
		});
		this.volume = restoreVolume;
		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] Auto-ducking restored to ${restoreVolume}`,
		);
	}

	/** Whether the player is currently ducked. */
	public get isDucked(): boolean {
		return this.autoDuckActive;
	}

	// ── Buffer Duration ──────────────────────────────────────────────────

	/**
	 * Sets the buffer duration for the player's audio stream.
	 * Higher values improve stability on bad networks but increase latency.
	 * Requires Lavalink v4 with buffer support.
	 *
	 * @param durationMs Buffer duration in ms (default depends on Lavalink config).
	 */
	public async setBufferDuration(durationMs: number): Promise<void> {
		if (durationMs < 0) throw new RangeError("Buffer duration must be >= 0.");
		this.set("bufferDuration", durationMs);
		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] Buffer duration set to ${durationMs}ms`,
		);
	}

	// ── State & Persistence ──────────────────────────────────────────────

	/**
	 * Returns a snapshot of the player's current state.
	 * Useful for persistence, debugging, or manual resume.
	 */
	public getStateSnapshot(): PlayerStateSnapshot {
		return {
			guildId: this.guild,
			track: this.queue.current?.track ?? null,
			position: this.position,
			volume: this.volume,
			paused: this.paused,
			filters: {
				distortion: this.filters.distortion,
				equalizer: this.filters.equalizer,
				karaoke: this.filters.karaoke,
				rotation: this.filters.rotation,
				timescale: this.filters.timescale,
				vibrato: this.filters.vibrato,
				volume: this.filters.volume,
			},
			voiceChannelId: this.voiceChannel,
			textChannelId: this.textChannel,
			trackRepeat: this.trackRepeat,
			queueRepeat: this.queueRepeat,
			dynamicRepeat: this.dynamicRepeat,
		};
	}

	/** Helper to serialize a Track into TrackPersistData. */
	private static trackToPersist(t: Track | UnresolvedTrack): TrackPersistData {
		return {
			encoded: (t as Track).track ?? "",
			title: t.title ?? "",
			author: t.author ?? "",
			uri: (t as Track).uri ?? "",
			duration: t.duration ?? 0,
			sourceName: (t as Track).sourceName ?? "unknown",
			identifier: (t as Track).identifier ?? "",
			artworkUrl: (t as Track).artworkUrl ?? "",
			isrc: (t as Track).isrc ?? "",
			isSeekable: (t as Track).isSeekable ?? true,
			isStream: (t as Track).isStream ?? false,
		};
	}

	/**
	 * Returns the full player state for persistence across restarts.
	 * Includes autoplay state, queue, filters, seed pool, and history.
	 */
	public getFullState(): PlayerPersistData {
		const botUser = this.get<{ id?: string } | string>("Internal_BotUser");
		const botUserId = typeof botUser === "string" ? botUser : botUser?.id ?? null;

		return {
			guildId: this.guild,
			voiceChannelId: this.voiceChannel,
			textChannelId: this.textChannel,
			nodeIdentifier: this.node.options.identifier!,
			currentTrack: this.queue.current ? StellaPlayer.trackToPersist(this.queue.current) : null,
			position: this.position,
			volume: this.volume,
			paused: this.paused,
			trackRepeat: this.trackRepeat,
			queueRepeat: this.queueRepeat,
			dynamicRepeat: this.dynamicRepeat,
			isAutoplay: this.isAutoplay,
			botUserId,
			autoplayHistory: this.autoplayHistory,
			autoplaySeedPool: [...this.autoplaySeedPool],
			queue: this.queue.map((t) => StellaPlayer.trackToPersist(t)),
			filters: {
				distortion: this.filters.distortion,
				equalizer: this.filters.equalizer,
				karaoke: this.filters.karaoke,
				rotation: this.filters.rotation,
				timescale: this.filters.timescale,
				vibrato: this.filters.vibrato,
				volume: this.filters.volume,
				activeFilters: this.filters.getActiveFilters(),
			},
		};
	}

	/**
	 * Restores player state from persisted data (used after bot restart + session resume).
	 * Restores autoplay, filters, history, seed pool, repeat modes, and queue.
	 */
	public restoreFromState(state: PlayerPersistData): void {
		this.manager.emit(
			"Debug",
			`[Player:${this.guild}] Restoring state — autoplay: ${state.isAutoplay}, queue: ${state.queue.length} tracks, filters: ${Object.entries(state.filters.activeFilters).filter(([, v]) => v).map(([k]) => k).join(",") || "none"}`,
		);

		// Restore autoplay state
		this.isAutoplay = state.isAutoplay;
		if (state.botUserId) {
			this.set("Internal_BotUser", { id: state.botUserId });
		}

		// Restore autoplay history and seed pool
		this.autoplayHistory = state.autoplayHistory ?? [];
		this.autoplaySeedPool = state.autoplaySeedPool ?? [];

		// Restore repeat modes
		this.trackRepeat = state.trackRepeat;
		this.queueRepeat = state.queueRepeat;
		this.dynamicRepeat = state.dynamicRepeat;

		// Restore volume
		this.volume = state.volume;

		// Restore filters (local state only — Lavalink already has them if session resumed)
		if (state.filters) {
			this.filters.restoreState(state.filters);
		}

		// Restore queue tracks
		if (state.queue?.length) {
			const tracks = state.queue.map((td) =>
				TrackUtils.build(
					{
						encoded: td.encoded,
						info: {
							title: td.title,
							author: td.author,
							uri: td.uri,
							length: td.duration,
							identifier: td.identifier,
							artworkUrl: td.artworkUrl,
							isrc: td.isrc,
							isSeekable: td.isSeekable,
							isStream: td.isStream,
							sourceName: td.sourceName,
						},
						pluginInfo: {},
					},
					state.botUserId ?? undefined,
				),
			);
			this.queue.push(...tracks);
		}
	}
}
