/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * Derived from LithiumX — Copyright (c) 2025 Anantix Network (MIT)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 *
 * Shared type definitions for StellaLib.
 * This file contains all interfaces/types used across multiple modules,
 * extracted here to avoid circular dependency issues.
 */

/** Detected Lavalink server version (3 or 4). */
export type LavalinkVersion = 3 | 4;

// ─── Player Types ───────────────────────────────────────────────────────

export type Sizes = "0" | "1" | "2" | "3" | "default" | "mqdefault" | "hqdefault" | "maxresdefault";

export type TrackSourceName =
	| "youtube"
	| "soundcloud"
	| "spotify"
	| "deezer"
	| "bandcamp"
	| "tidal"
	| "applemusic"
	| "jiosaavn"
	| string;

export interface PlayerOptions {
	/** The guild the Player belongs to. */
	guild: string;
	/** The text channel the Player belongs to. */
	textChannel?: string;
	/** The voice channel the Player belongs to. */
	voiceChannel?: string;
	/** The node the Player uses. */
	node?: string;
	/** The initial volume the Player will use. */
	volume?: number;
	/** If the player should mute itself. */
	selfMute?: boolean;
	/** If the player should deaf itself. */
	selfDeafen?: boolean;
}

/** If track partials are set some of these will be `undefined` as they were removed. */
export interface Track {
	/** The base64 encoded track. */
	readonly track: string;
	/** The artwork URL of the track. */
	readonly artworkUrl: string;
	/** The track source name. */
	readonly sourceName: TrackSourceName;
	/** The title of the track. */
	title: string;
	/** The identifier of the track. */
	readonly identifier: string;
	/** The author of the track. */
	author: string;
	/** The duration of the track. */
	readonly duration: number;
	/** The ISRC of the track. */
	readonly isrc: string;
	/** If the track is seekable. */
	readonly isSeekable: boolean;
	/** If the track is a stream. */
	readonly isStream: boolean;
	/** The URI of the track. */
	readonly uri: string;
	/** The thumbnail of the track or null if unsupported source. */
	readonly thumbnail: string | null;
	/** The user that requested the track. */
	readonly requester: string | null | undefined;
	/** Displays the track thumbnail with optional size. */
	displayThumbnail(size?: Sizes): string | null;
	/** Additional track info provided by plugins. */
	pluginInfo: TrackPluginInfo;
	/** Add your own data to the track. */
	customData: Record<string, unknown>;
}

export interface TrackPluginInfo {
	albumName?: string;
	albumUrl?: string;
	artistArtworkUrl?: string;
	artistUrl?: string;
	isPreview?: string;
	previewUrl?: string;
	[key: string]: string | undefined;
}

/** Unresolved tracks can't be played normally, they will resolve before playing into a Track. */
export interface UnresolvedTrack extends Partial<Track> {
	/** The title to search against. */
	title: string;
	/** The author to search against. */
	author?: string;
	/** The duration to search within 1500 milliseconds of the results. */
	duration?: number;
	/** Resolves into a Track. */
	resolve(): Promise<void>;
}

export interface PlayOptions {
	/** The position to start the track. */
	readonly startTime?: number;
	/** The position to end the track. */
	readonly endTime?: number;
	/** Whether to not replace the track if a play payload is sent. */
	readonly noReplace?: boolean;
}

export interface EqualizerBand {
	/** The band number being 0 to 14. */
	band: number;
	/** The gain amount being -0.25 to 1.00, 0.25 being double. */
	gain: number;
}

// ─── Node Types ─────────────────────────────────────────────────────────

export interface NodeOptions {
	/** The host for the node. */
	host: string;
	/** The port for the node. */
	port?: number;
	/** The password for the node. */
	password?: string;
	/** Whether the host uses SSL. */
	secure?: boolean;
	/** The identifier for the node. */
	identifier?: string;
	/** The retryAmount for the node. */
	retryAmount?: number;
	/** The retryDelay for the node (ms). */
	retryDelay?: number;
	/** Whether to resume the previous session. */
	resumeStatus?: boolean;
	/** The timeout for session resume (seconds). */
	resumeTimeout?: number;
	/** The timeout used for API calls (ms). */
	requestTimeout?: number;
	/** Priority of the node (higher = more likely to be selected). */
	priority?: number;
	/** Heartbeat interval in ms to detect dead connections (0 = disabled, default: 30000). */
	heartbeatInterval?: number;
}

export interface NodeStats {
	players: number;
	playingPlayers: number;
	uptime: number;
	memory: MemoryStats;
	cpu: CPUStats;
	frameStats: FrameStats;
}

export interface MemoryStats {
	free: number;
	used: number;
	allocated: number;
	reservable: number;
}

export interface CPUStats {
	cores: number;
	systemLoad: number;
	lavalinkLoad: number;
}

export interface FrameStats {
	sent?: number;
	nulled?: number;
	deficit?: number;
}

export interface LavalinkInfo {
	version: { semver: string; major: number; minor: number; patch: number; preRelease: string };
	buildTime: number;
	git: { branch: string; commit: string; commitTime: number };
	jvm: string;
	lavaplayer: string;
	sourceManagers: string[];
	filters: string[];
	plugins: { name: string; version: string }[];
}

// ─── Voice Types ────────────────────────────────────────────────────────

export interface VoiceState {
	op: "voiceUpdate";
	guildId: string;
	event: VoiceServer;
	sessionId?: string;
	channelId?: string;
}

export interface VoiceServer {
	token: string;
	guild_id: string;
	endpoint: string;
}

export interface VoiceStateUpdate {
	guild_id: string;
	user_id: string;
	session_id: string;
	channel_id: string;
}

export interface VoicePacket {
	t?: "VOICE_SERVER_UPDATE" | "VOICE_STATE_UPDATE";
	d: VoiceStateUpdate | VoiceServer;
}

// ─── Event Types ────────────────────────────────────────────────────────

export type LoadType = "track" | "playlist" | "search" | "empty" | "error";

export type State = "CONNECTED" | "CONNECTING" | "DISCONNECTED" | "DISCONNECTING" | "DESTROYING" | "MOVING";

export type PlayerEventType =
	| "TrackStartEvent"
	| "TrackEndEvent"
	| "TrackExceptionEvent"
	| "TrackStuckEvent"
	| "WebSocketClosedEvent";

export type TrackEndReason = "finished" | "loadFailed" | "stopped" | "replaced" | "cleanup";

export type Severity = "common" | "suspicious" | "fault";

export type PlayerEvents =
	| TrackStartEvent
	| TrackEndEvent
	| TrackStuckEvent
	| TrackExceptionEvent
	| WebSocketClosedEvent;

export interface TrackData {
	/** The base64 encoded track. */
	encoded: string;
	/** The detailed track information. */
	info: TrackDataInfo;
	/** Additional track info provided by plugins. */
	pluginInfo: Record<string, string>;
}

export interface TrackDataInfo {
	identifier: string;
	isSeekable: boolean;
	author: string;
	length: number;
	isrc?: string;
	isStream: boolean;
	title: string;
	uri?: string;
	artworkUrl?: string;
	sourceName?: TrackSourceName;
}

export interface PlayerEvent {
	op: "event";
	type: PlayerEventType;
	guildId: string;
}

export interface Exception {
	message: string;
	severity: Severity;
	cause: string;
}

export interface TrackStartEvent extends PlayerEvent {
	type: "TrackStartEvent";
	track: TrackData;
}

export interface TrackEndEvent extends PlayerEvent {
	type: "TrackEndEvent";
	track: TrackData;
	reason: TrackEndReason;
}

export interface TrackExceptionEvent extends PlayerEvent {
	type: "TrackExceptionEvent";
	exception?: Exception;
	guildId: string;
}

export interface TrackStuckEvent extends PlayerEvent {
	type: "TrackStuckEvent";
	thresholdMs: number;
}

export interface WebSocketClosedEvent extends PlayerEvent {
	type: "WebSocketClosedEvent";
	code: number;
	reason: string;
	byRemote: boolean;
}

export interface PlayerUpdate {
	op: "playerUpdate";
	guildId: string;
	state: {
		time: number;
		position: number;
		connected: boolean;
		ping: number;
	};
}

export interface NodeMessage extends NodeStats {
	type: PlayerEventType;
	op: "stats" | "playerUpdate" | "event";
	guildId: string;
}

// ─── Misc Types ─────────────────────────────────────────────────────────

export interface UnresolvedQuery {
	/** The title of the unresolved track. */
	title: string;
	/** The author of the unresolved track. */
	author?: string;
	/** The duration of the unresolved track. */
	duration?: number;
}

// ─── REST Types ─────────────────────────────────────────────────────────

export interface RestPlayOptions {
	guildId: string;
	data: {
		/** The base64 encoded track. */
		encodedTrack?: string | null;
		/** The track identifier. */
		identifier?: string;
		/** The track time to start at. */
		startTime?: number;
		/** The track time to end at. */
		endTime?: number;
		/** The player volume level. */
		volume?: number;
		/** The player position in a track. */
		position?: number;
		/** Whether the player is paused. */
		paused?: boolean;
		/** The audio filters. */
		filters?: object;
		/** Voice connection payload. */
		voice?: {
			token: string;
			sessionId: string;
			endpoint: string;
			channelId?: string;
		};
		/** Whether to not replace the current track. */
		noReplace?: boolean;
	};
}

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

// ─── Manager Types ──────────────────────────────────────────────────────

export interface Payload {
	/** The OP code */
	op: number;
	d: {
		guild_id: string;
		channel_id: string | null;
		self_mute: boolean;
		self_deaf: boolean;
	};
}

export type SearchPlatform =
	| "deezer"
	| "soundcloud"
	| "youtube music"
	| "youtube"
	| "spotify"
	| "jiosaavn"
	| "tidal"
	| "applemusic"
	| "bandcamp";

export interface SearchQuery {
	/** The source to search from. */
	source?: SearchPlatform | string;
	/** The query to search for. */
	query: string;
}

export interface LavalinkResponse {
	loadType: LoadType;
	data: TrackData[] | PlaylistRawData;
}

export interface SearchResult {
	/** The load type of the result. */
	loadType: LoadType;
	/** The array of tracks from the result. */
	tracks: Track[];
	/** The playlist info if the load type is 'playlist'. */
	playlist?: PlaylistData;
}

export interface PlaylistRawData {
	info: {
		/** The playlist name. */
		name: string;
	};
	/** Addition info provided by plugins. */
	pluginInfo: object;
	/** The tracks of the playlist. */
	tracks: TrackData[];
}

export interface PlaylistData {
	/** The playlist name. */
	name: string;
	/** The length of the playlist. */
	duration: number;
	/** The songs of the playlist. */
	tracks: Track[];
}

/** Interface for persisting session IDs across bot restarts. */
export interface SessionStore {
	/** Load a saved session ID for a node identifier. */
	get(nodeId: string): Promise<string | null> | string | null;
	/** Save a session ID for a node identifier. */
	set(nodeId: string, sessionId: string): Promise<void> | void;
	/** Delete a saved session ID. */
	delete(nodeId: string): Promise<void> | void;
}

/** Snapshot of a player's state, used for resume after reconnect. */
export interface PlayerStateSnapshot {
	guildId: string;
	track: string | null;
	position: number;
	volume: number;
	paused: boolean;
	filters: object;
	voiceChannelId: string | null;
	textChannelId: string | null;
	trackRepeat: boolean;
	queueRepeat: boolean;
	dynamicRepeat: boolean;
}

export interface ManagerOptions {
	/** Use priority mode over least amount of player or load? */
	usePriority?: boolean;
	/** Use the least amount of players or least load? */
	useNode?: "leastLoad" | "leastPlayers";
	/** The array of nodes to connect to. */
	nodes?: NodeOptions[];
	/** The client ID to use. */
	clientId?: string;
	/** Value to use for the `Client-Name` header. */
	clientName?: string;
	/** The shard count. */
	shards?: number;
	/** A array of plugins to use. */
	plugins?: any[];
	/** Whether players should automatically play the next song. */
	autoPlay?: boolean;
	/** An array of track properties to keep. `track` will always be present. */
	trackPartial?: string[];
	/** The default search platform to use. */
	defaultSearchPlatform?: SearchPlatform;
	/**
	 * Fallback search platforms to try when the primary returns empty.
	 * Tried in order until one returns results.
	 * Example: ["soundcloud", "deezer", "spotify"]
	 */
	searchFallback?: SearchPlatform[];
	/** Whether the YouTube video titles should be replaced. */
	replaceYouTubeCredentials?: boolean;
	/** Cache settings for search results. */
	caches?: {
		/** Whether to cache the search results. */
		enabled: boolean;
		/** The time to cache the search results (ms). */
		time: number;
		/** Maximum number of cached search results (default: 200). */
		maxSize?: number;
	};
	/** Session store for persisting session IDs across bot restarts. */
	sessionStore?: SessionStore;
	/**
	 * Function to send data to the Discord websocket.
	 * @param id Guild ID
	 * @param payload The payload to send
	 */
	send(id: string, payload: Payload): void;
}

// ─── Manager Events ─────────────────────────────────────────────────────

export interface ManagerEvents {
	NodeCreate: (node: any) => void;
	NodeDestroy: (node: any) => void;
	NodeConnect: (node: any) => void;
	NodeReconnect: (node: any) => void;
	NodeDisconnect: (node: any, reason: { code?: number; reason?: string }) => void;
	NodeError: (node: any, error: Error) => void;
	NodeRaw: (payload: unknown) => void;
	PlayerCreate: (player: any) => void;
	PlayerDestroy: (player: any) => void;
	PlayerStateUpdate: (oldPlayer: any, newPlayer: any) => void;
	PlayerMove: (player: any, initChannel: string, newChannel: string) => void;
	PlayerDisconnect: (player: any, oldChannel: string) => void;
	QueueEnd: (player: any, track: Track | UnresolvedTrack, payload: TrackEndEvent) => void;
	SocketClosed: (player: any, payload: WebSocketClosedEvent) => void;
	TrackStart: (player: any, track: Track, payload: TrackStartEvent) => void;
	TrackEnd: (player: any, track: Track, payload: TrackEndEvent) => void;
	TrackStuck: (player: any, track: Track, payload: TrackStuckEvent) => void;
	TrackError: (player: any, track: Track | UnresolvedTrack, payload: TrackExceptionEvent | unknown) => void;
	Debug: (message: string) => void;
}
