/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * Derived from LithiumX — Copyright (c) 2025 Anantix Network (MIT)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 */
import type { RestPlayOptions, Method, LavalinkResponse, LavalinkInfo, LoadType, TrackData, LavalinkVersion } from "./Types";

/** Maximum number of retries for rate-limited (429) requests. */
const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * Handles the requests sent to the Lavalink REST API.
 * Automatically adapts to Lavalink v3 and v4 protocols.
 */
class StellaRest {
	/** The Node that this Rest instance is connected to. */
	private node: any;
	/** The ID of the current session (v4) or resume key (v3). */
	private sessionId: string;
	/** The password for the Node. */
	private readonly password: string;
	/** The base URL for REST requests. */
	private readonly baseUrl: string;
	/** Request timeout in ms. */
	private readonly timeout: number;
	/** In-flight request deduplication for GET requests. */
	private readonly inflightGets = new Map<string, Promise<unknown>>();
	/** Total number of requests made. */
	public requestCount = 0;
	/** Total number of failed requests. */
	public failedCount = 0;
	/** Detected Lavalink version for protocol adaptation. */
	private version: LavalinkVersion = 4;

	constructor(node: any) {
		this.node = node;
		this.sessionId = node.sessionId!;
		this.password = node.options.password!;
		this.baseUrl = `http${node.options.secure ? "s" : ""}://${node.options.host}:${node.options.port}`;
		this.timeout = node.options.requestTimeout ?? 15000;
	}

	/** Sets the Lavalink version for protocol adaptation. */
	public setVersion(v: LavalinkVersion): void {
		this.version = v;
	}

	/** Gets the detected Lavalink version. */
	public getVersion(): LavalinkVersion {
		return this.version;
	}

	/**
	 * Sets the session ID.
	 * @returns The session ID.
	 */
	public setSessionId(sessionId: string): string {
		this.sessionId = sessionId;
		return this.sessionId;
	}

	// ── Version-aware high-level methods ────────────────────────────────

	/**
	 * Load tracks — normalizes v3 response to v4 format automatically.
	 * @param identifier The search query or URL identifier.
	 */
	public async loadTracks(identifier: string): Promise<LavalinkResponse> {
		const prefix = this.version === 3 ? "" : "/v4";
		const raw = await this.get(`${prefix}/loadtracks?identifier=${encodeURIComponent(identifier)}`);
		return this.version === 3 ? this.normalizeV3LoadResponse(raw) : raw as LavalinkResponse;
	}

	/** Normalize v3 loadtracks response to v4 LavalinkResponse format. */
	private normalizeV3LoadResponse(raw: any): LavalinkResponse {
		const V3_TYPE_MAP: Record<string, LoadType> = {
			TRACK_LOADED: "track",
			PLAYLIST_LOADED: "playlist",
			SEARCH_RESULT: "search",
			NO_MATCHES: "empty",
			LOAD_FAILED: "error",
		};

		const loadType: LoadType = V3_TYPE_MAP[raw.loadType] ?? "empty";

		const normTrack = (t: any): TrackData => ({
			encoded: t.track ?? t.encoded ?? "",
			info: t.info ?? {},
			pluginInfo: t.pluginInfo ?? {},
		});

		let data: any;
		switch (loadType) {
			case "track":
				data = raw.tracks?.length ? normTrack(raw.tracks[0]) : { encoded: "", info: {}, pluginInfo: {} };
				break;
			case "search":
				data = (raw.tracks ?? []).map(normTrack);
				break;
			case "playlist":
				data = {
					info: { name: raw.playlistInfo?.name ?? "Unknown" },
					pluginInfo: {},
					tracks: (raw.tracks ?? []).map(normTrack),
				};
				break;
			default:
				data = (raw.tracks ?? []).map(normTrack);
		}

		return { loadType, data };
	}

	/**
	 * Fetch Lavalink server info.
	 * v3: GET /version (returns minimal info), v4: GET /v4/info.
	 */
	public async getInfo(): Promise<LavalinkInfo> {
		if (this.version === 3) {
			const url = `${this.baseUrl}/version`;
			const res = await fetch(url, {
				headers: { Authorization: this.password },
				signal: AbortSignal.timeout(this.timeout),
			});
			const text = (await res.text()).trim();
			return {
				version: { semver: text, major: 3, minor: 0, patch: 0, preRelease: "" },
				buildTime: 0,
				git: { branch: "", commit: "", commitTime: 0 },
				jvm: "",
				lavaplayer: "",
				sourceManagers: [],
				filters: [],
				plugins: [],
			} as LavalinkInfo;
		}
		return (await this.get("/v4/info")) as LavalinkInfo;
	}

	/** Decode tracks — version-aware endpoint. */
	public async decodeTracks(tracks: string[]): Promise<unknown> {
		const prefix = this.version === 3 ? "" : "/v4";
		return await this.post(`${prefix}/decodetracks`, tracks);
	}

	/**
	 * Configure session resume.
	 * v3: sends configureResuming WS op, v4: REST PATCH /v4/sessions/{id}.
	 */
	public async configureResume(timeout: number): Promise<void> {
		if (this.version === 3) {
			this.node.sendWs({
				op: "configureResuming",
				key: this.sessionId,
				timeout,
			});
		} else {
			await this.patch(`/v4/sessions/${this.sessionId}`, {
				resuming: true,
				timeout,
			});
		}
	}

	/**
	 * Get all players on this node.
	 * v3: not supported (returns empty array), v4: REST GET.
	 */
	public async getAllPlayers(): Promise<unknown> {
		if (this.version === 3) return [];
		return await this.get(`/v4/sessions/${this.sessionId}/players`);
	}

	/**
	 * Get a single player's state.
	 * v3: not supported (returns null), v4: REST GET.
	 */
	public async getPlayer(guildId: string): Promise<unknown> {
		if (this.version === 3) return null;
		return await this.get(`/v4/sessions/${this.sessionId}/players/${guildId}`);
	}

	/**
	 * Update player state.
	 * v3: translates to WebSocket ops, v4: REST PATCH.
	 */
	public async updatePlayer(options: RestPlayOptions): Promise<unknown> {
		if (this.version === 3) return this.updatePlayerV3(options);
		const noReplace = options.data?.noReplace ?? false;
		return await this.patch(
			`/v4/sessions/${this.sessionId}/players/${options.guildId}?noReplace=${noReplace}`,
			options.data,
		);
	}

	/**
	 * v3 player updates via WebSocket ops.
	 * Decomposes the v4-style data into individual v3 WS ops.
	 */
	private updatePlayerV3(options: RestPlayOptions): unknown {
		const { guildId, data } = options;
		if (!data) return {};

		// Voice update → voiceUpdate op
		if (data.voice) {
			this.node.sendWs({
				op: "voiceUpdate",
				guildId,
				sessionId: data.voice.sessionId,
				event: {
					token: data.voice.token,
					guild_id: guildId,
					endpoint: data.voice.endpoint,
				},
			});
		}

		// Play or Stop
		if (data.encodedTrack !== undefined) {
			if (data.encodedTrack === null) {
				this.node.sendWs({ op: "stop", guildId });
			} else {
				const playOp: Record<string, unknown> = {
					op: "play",
					guildId,
					track: data.encodedTrack,
					noReplace: data.noReplace ?? false,
				};
				if (data.startTime !== undefined) playOp.startTime = data.startTime;
				if (data.endTime !== undefined) playOp.endTime = data.endTime;
				if (data.position !== undefined) playOp.startTime = data.position;
				this.node.sendWs(playOp);
			}
		}

		// Pause
		if (data.paused !== undefined) {
			this.node.sendWs({ op: "pause", guildId, pause: data.paused });
		}

		// Seek (only if not changing track)
		if (data.position !== undefined && data.encodedTrack === undefined) {
			this.node.sendWs({ op: "seek", guildId, position: data.position });
		}

		// Volume
		if (data.volume !== undefined) {
			this.node.sendWs({ op: "volume", guildId, volume: data.volume });
		}

		// Filters
		if (data.filters) {
			this.node.sendWs({ op: "filters", guildId, ...(data.filters as object) });
		}

		return {};
	}

	/**
	 * Destroy a player.
	 * v3: WS destroy op, v4: REST DELETE.
	 */
	public async destroyPlayer(guildId: string): Promise<unknown> {
		if (this.version === 3) {
			this.node.sendWs({ op: "destroy", guildId });
			return {};
		}
		return await this.delete(`/v4/sessions/${this.sessionId}/players/${guildId}`);
	}

	// ── Core HTTP methods ───────────────────────────────────────────────

	/**
	 * Core request method with:
	 * - AbortController timeout
	 * - Automatic retry on 429 (rate limit) with Retry-After
	 * - Proper error wrapping
	 */
	private async request(method: Method, endpoint: string, body?: unknown, retryCount = 0): Promise<unknown> {
		const url = `${this.baseUrl}${endpoint}`;
		this.requestCount++;

		this.node.manager.emit("Debug", `[REST] ${method} ${url}${retryCount > 0 ? ` (retry ${retryCount})` : ""}`);

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);

		const config: RequestInit = {
			method,
			headers: {
				"Content-Type": "application/json",
				Authorization: this.password,
			},
			body: body ? JSON.stringify(body) : null,
			signal: controller.signal,
		};

		try {
			const response = await fetch(url, config);
			clearTimeout(timeoutId);

			// Handle rate limiting with automatic retry
			if (response.status === 429 && retryCount < MAX_RATE_LIMIT_RETRIES) {
				const retryAfter = response.headers.get("Retry-After");
				const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000 * (retryCount + 1);

				this.node.manager.emit(
					"Debug",
					`[REST] Rate limited on ${method} ${endpoint}, retrying in ${delay}ms`,
				);

				await new Promise((resolve) => setTimeout(resolve, delay));
				return this.request(method, endpoint, body, retryCount + 1);
			}

			const contentType = response.headers.get("content-type");

			if (!response.ok) {
				this.failedCount++;
				let errorBody = "";
				try {
					errorBody = await response.text();
				} catch { /* ignore */ }
				const error = new Error(
					`REST ${method} ${endpoint} returned ${response.status}: ${errorBody}`,
				);
				this.node.manager.emit("NodeError", this.node, error);
				throw error;
			}

			if (!contentType || !contentType.includes("application/json")) {
				return response.status >= 200 && response.status < 300 ? {} : null;
			}

			const text = await response.text();
			if (!text || text.trim() === "") return {};
			return JSON.parse(text);
		} catch (error) {
			clearTimeout(timeoutId);

			// Handle abort (timeout)
			if ((error as Error).name === "AbortError") {
				this.failedCount++;
				const wrapped = new Error(`REST ${method} ${endpoint} timed out after ${this.timeout}ms`);
				this.node.manager.emit("NodeError", this.node, wrapped);
				throw wrapped;
			}

			if ((error as Error).message?.startsWith("REST ")) throw error;
			this.failedCount++;
			const wrapped = new Error(`REST ${method} ${endpoint} failed: ${(error as Error).message}`);
			this.node.manager.emit("NodeError", this.node, wrapped);
			throw wrapped;
		}
	}

	/**
	 * Sends a GET request with deduplication.
	 * If an identical GET is already in-flight, returns the same promise.
	 */
	public async get(endpoint: string): Promise<unknown> {
		const existing = this.inflightGets.get(endpoint);
		if (existing) return existing;

		const promise = this.request("GET", endpoint).finally(() => {
			this.inflightGets.delete(endpoint);
		});

		this.inflightGets.set(endpoint, promise);
		return promise;
	}

	/** Sends a PATCH request. */
	public async patch(endpoint: string, body: unknown): Promise<unknown> {
		return await this.request("PATCH", endpoint, body);
	}

	/** Sends a POST request. */
	public async post(endpoint: string, body: unknown): Promise<unknown> {
		return await this.request("POST", endpoint, body);
	}

	/** Sends a DELETE request. */
	public async delete(endpoint: string): Promise<unknown> {
		return await this.request("DELETE", endpoint);
	}
}

export { StellaRest };
