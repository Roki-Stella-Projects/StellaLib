# Changelog

All notable changes to StellaLib will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-04-04

### Added
- **Zombie Node Detection** — Monitors `playerUpdate` timestamps on each node. When a node is connected but stops sending player updates for playing players (default: 30s silence), it is flagged as "zombie" and players are seamlessly moved to healthy nodes. Catches frozen Lavalink processes that pass TCP/heartbeat checks but have internally deadlocked. Configure via `ManagerOptions.zombieDetection` (`checkInterval`, `maxSilence`). New `NodeZombie` event
- **REST Backpressure (Token Bucket)** — Global request rate limiter in `StellaRest` using a token bucket algorithm. Prevents self-DDoS when 100+ users run `/play` simultaneously. Bursts are allowed (up to `bucketSize`) but sustained rate is capped (default: 20 req/s). Requests queue in FIFO order when the bucket is empty. Configure via `ManagerOptions.restBackpressure` (`maxRequestsPerSecond`, `bucketSize`). `rest.pendingRequests` getter for monitoring
- **Track Serialization (Memory Protection)** — `queue.compactQueue()` strips heavy metadata (pluginInfo, customData, thumbnail, artworkUrl, isrc) from queued tracks, keeping only what's needed for playback (`encoded`, `title`, `author`, `duration`, `uri`). At 700+ servers with 50-track queues, reduces RAM by 50-70%. `queue.memoryEstimate` getter for monitoring. `StellaQueue.isCompacted(track)` static helper
- **Voice Hot-Swapping (Silent Re-Identify)** — When Discord rotates voice servers (code 4015) or a UDP desync occurs (code 4000), `player.reconnectVoice()` refreshes the voice token and endpoint without clearing the queue or filters. The user hears a ~1s gap, then music resumes automatically. Code 4006 (session invalid) also attempts re-identify before giving up. New `VoiceReconnect` event

### Improved
- **`socketClosed` handler** — Now distinguishes between recoverable codes (4000, 4015, 4006 → auto-reconnect) and fatal codes (4014 → cleanup). Previously all non-4014 codes were ignored
- **Node `lastPlayerUpdate` tracking** — Public timestamp property updated on every `playerUpdate` WebSocket message, used by zombie detection and available for external monitoring
- **`StellaRest.destroy()`** — New method to clean up the token bucket rate limiter on node shutdown
- **`StellaRest.pendingRequests`** — Getter that returns the number of requests waiting in the backpressure queue

## [1.2.0] - 2026-04-04

### Added
- **SponsorBlock integration** — `player.setSponsorBlock(categories)`, `player.getSponsorBlock()`, `player.clearSponsorBlock()` for auto-skipping sponsor segments, intros, outros, and more. Requires the SponsorBlock Lavalink plugin. New `SegmentSkipped` event
- **LavaSearch structured search** — `manager.lavaSearch(query)` returns rich results with tracks, albums, artists, playlists, and text suggestions. Requires the LavaSearch Lavalink plugin. New types: `LavaSearchQuery`, `LavaSearchResult`, `LavaSearchPlaylistInfo`, `LavaSearchText`
- **RoutePlanner API** — `manager.getRoutePlannerStatus()`, `manager.freeRoutePlannerAddress(address)`, `manager.freeAllRoutePlannerAddresses()` for IP rotation management and anti-429 monitoring. New types: `RoutePlannerStatus`, `RoutePlannerDetails`
- **Opus priority search** — `ManagerOptions.opusPriority: true` re-orders search results so Opus-native sources (SoundCloud, YouTube Music) appear first. Discord uses Opus natively — zero transcode = lower CPU + best fidelity
- **Crossfade emulation** — `player.setCrossfade(ms)` enables smooth volume fade-out transitions between tracks. Monitors track position and gradually reduces volume as the current track approaches its end. Volume auto-restores on `TrackStart`. New `CrossfadeStart` event
- **Auto-ducking** — `player.duck(volume)` / `player.unduck()` for temporarily reducing music volume during TTS or voice announcements. `player.isDucked` getter
- **Buffer duration control** — `player.setBufferDuration(ms)` for adjusting audio stream buffer size
- **WebSocket compression** — `NodeOptions.wsCompression: true` enables per-message deflate compression, reducing network overhead by up to 60% for high-traffic bots
- **REST PUT method** — `rest.put(endpoint, body)` for plugin APIs that require PUT requests

### Fixed
- **`Manager.destroy(guild)` silently leaked resources** — Previously only deleted the player from the map without calling `player.destroy()`. Now properly disconnects, stops timers, and cleans up before removing
- **Fire-and-forget REST calls** — `player.setVolume()`, `player.stop()`, `player.pause()`, `player.seek()`, `player.restart()` now properly `await` their REST calls instead of silently ignoring failures
- **`Filters.setFilter()` double REST call** — The `setFilter()` dispatcher called `updateFilters()` after the individual filter method already triggered it via `applyFilter()`. Removed the redundant call
- **`Filters.clearFilters()` instance replacement bug** — Previously created a new `Filters` instance on `this.player.filters` but continued modifying the old `this` instance. Now directly resets all properties on the current instance
- **`Filters.setVaporwave()` double REST call** — Compound filters (vaporwave) that modify both equalizer and timescale now batch the changes: first change is applied without update (`shouldUpdate=false`), second triggers the single REST call

### Improved
- **`Method` type** — Added `"PUT"` to the union for plugin API compatibility

## [1.1.3] - 2026-04-03

### Fixed
- **AutoMix style drift** — The autoplay engine now stays on-style across sessions. Previously, short or generic artist names (e.g. `sea.`) caused SoundCloud searches to return completely unrelated tracks, which compounded with each pick — drifting from Thai pop into Schranz edits within 3 songs
- **Short/generic author search pollution** — Strategy 2 no longer searches SoundCloud with bare author names shorter than 5 meaningful characters. For example, `sea.` now searches `scsearch:sea. สมดุลรัก Balance` (author + title keywords) instead of `scsearch:sea.`, yielding accurate results
- **Autoplay anchor lost on style drift** — Introduced `player.autoplayAnchor`: the very first track that starts each autoplay session. The anchor is preserved permanently (not rotated out like the 5-track seed pool), so every scoring call can still measure similarity to the user's original choice even after many tracks
- **Scoring only compared against `previousTrack`** — Candidate scoring now includes two additional layers: anchor similarity (+25 author match, +18 title keyword overlap, +5 source match) and seed-pool-wide author affinity (bonus if the candidate's artist appears in any of the last 5 seeds). This pulls candidate selection back toward the original style even when the pool has drifted
- **`setAutoplay(false)` now resets state** — Disabling autoplay now clears `autoplayAnchor`, `autoplaySeedPool`, and `autoplayHistory`, so enabling it again starts fresh rather than inheriting stale context from the previous session

### Improved
- **Strategy 2 search query order** — Author + title-keyword combination is always tried first before bare author. YouTube fallback also includes title context instead of a generic `music` suffix
- **Cross-artist seed search** — When using an alternate seed pool author for cross-artist transitions, short names (<= 5 chars stripped) now also receive title keyword context to avoid generic search results

## [1.1.2] - 2026-04-04

### Added
- **Seamless node failover** — When a node dies mid-playback, all playing/paused players are **immediately** moved to a healthy node with position preserved. Audio gap is typically <150ms
- **`PlayerFailover` event** — Emitted when a player is seamlessly moved to a new node, with old and new node identifiers
- **`attemptSeamlessFailover()`** — Internal method that rescues players on unexpected close, fatal close, and session invalidation
- **Smart player distribution** — During failover, players are distributed across available nodes by load (not all dumped on one node)
- **Test suite** — `tests/queue.test.ts`, `tests/failover.test.ts`, `tests/player.test.ts` with comprehensive Bun test coverage
- **GitHub templates** — Bug report, feature request, and PR templates in `.github/`
- **CONTRIBUTING.md** — Developer guide with setup, project structure, code style, and PR process
- **Failover documentation** — `docs/13-seamless-failover.md` with architecture diagrams, API reference, and best practices

### Improved
- **`moveNode()` reordered** — Voice state is now sent **before** the track, so Lavalink joins the voice channel first for faster audio resume
- **Failover on fatal close codes** — Even when a node hits a fatal close code (4001, 4004), playing players are still rescued to healthy nodes
- **Node close handler** — Seamless failover triggers immediately on unexpected disconnect, before the reconnect cycle starts

## [1.1.1] - 2026-04-04

### Added
- **Player inactivity timeout** — Auto-disconnect when the bot is alone in a voice channel. Configurable via `PlayerOptions.inactivityTimeout` (ms). Methods: `player.startInactivityTimer()`, `player.stopInactivityTimer()`
- **Queue max size limit** — Configurable per-player via `PlayerOptions.maxQueueSize`. Queue.add() enforces the limit and truncates excess tracks. Methods: `player.canAddToQueue(count)`, `player.queueSpaceRemaining`
- **Track deduplication** — Set `player.queue.noDuplicates = true` to prevent adding duplicate tracks. Matches by URI and title+author combo via `queue.isDuplicate(track)`
- **Node health monitoring** — Proactive health checks that auto-migrate players from overloaded nodes before they crash. Configure via `ManagerOptions.nodeHealthThresholds` (CPU load, frame deficit, check interval)
- **`isPlayerStateStore()` type guard** — Exported helper to validate custom player state store objects at runtime
- **`nodeHealthThresholds` option in `ManagerOptions`** — Configure max CPU load (default 0.9), max frame deficit (default 500), and check interval (default 60s)

### Fixed
- **`player.destroy()` now deletes persisted state** — Destroyed players no longer resurrect on next restart. Calls `store.deletePlayerState()` on destroy
- **Autoplay `commitTrack` unhandled rejection** — `player.play()` inside the autoplay engine is now wrapped in try/catch to prevent silent crashes
- **Voice socket close code 4014 handling** — When Discord kicks the bot from voice (code 4014) or invalidates the session (4006), the player state is properly cleaned up instead of hanging
- **Search cache key normalization** — Cache keys are now trimmed and lowercased, so `"Nightcore remix"` and `"nightcore remix"` share the same cache entry

### Improved
- **THIRD-PARTY-NOTICES.md** — Added credits for Erela.js, MagmaStream, and Lavalink with proper license and attribution details
- **Health check interval cleanup** — Node health monitor interval is properly cleared on `manager.shutdown()`

## [1.1.0] - 2026-04-04

### Added
- **Full player state persistence** — Autoplay state, queue, filters, repeat modes, seed pool, and history now survive bot restarts via `PlayerStateStore`
- **`PlayerPersistData` / `TrackPersistData` types** — Structured interfaces for serializing complete player state
- **`PlayerStateStore` interface** — Pluggable store for persisting player state (auto-detected from `FileSessionStore`)
- **`FileSessionStore` now implements `PlayerStateStore`** — Zero-config: player states are saved alongside session IDs in the same JSON file with backward-compatible format migration
- **`Player.getFullState()`** — Returns complete player state snapshot including autoplay, queue, filters, history, and seed pool
- **`Player.restoreFromState()`** — Restores full player state from persisted data after bot restart
- **`Filters.getActiveFilters()`** — Returns a map of all active filter presets for persistence
- **`Filters.restoreState()`** — Restores filter configuration from persisted data without sending to Lavalink
- **`Filters.applyFilters()`** — Public method to send current filter state to Lavalink (use after `restoreState()`)
- **`Manager.getPlayerStateStore()`** — Returns the player state store (explicit or auto-detected from sessionStore)
- **Auto-failover** — When a node dies, players are automatically moved to the healthiest available node instead of being destroyed
- **Faster first reconnect** — First reconnect attempt uses a 2s fast-retry for quick recovery from transient failures
- **Spotify direct playback** — Autoplay now tries playing Spotify recommendations directly before falling back to SoundCloud/YouTube mirrors
- **YouTube fallback for Spotify recs** — Autoplay adds YouTube as a second fallback when SoundCloud mirror fails
- **`playerStateStore` option in `ManagerOptions`** — Optional explicit player state store (falls back to sessionStore auto-detection)

### Fixed
- **`destroyNode` infinite loop** — `Manager.destroyNode()` and `Node.destroy()` no longer call each other recursively
- **`handleFailedTrack` missing await** — `queueEnd()` is now properly awaited in failed track handler, preventing unhandled promise rejections
- **`handleRepeatedTrack` missing await** — `queueEnd()` is now properly awaited in repeated track handler
- **`dynamicLoopInterval` leak on `moveNode()`** — Interval is now cleared before moving to a new node
- **`dynamicLoopInterval` leak on `disconnect()`** — Interval is now cleared when disconnecting from voice
- **Cache prune interval leak** — `setInterval` reference is now stored and cleared on `shutdown()`
- **YouTube video ID extraction** — Robust URL parsing using `URL` API with regex fallback; handles `/watch?v=`, `/shorts/`, `youtu.be/` formats correctly
- **Autoplay history deduplication** — Tracks are now deduplicated by both URI and title+author combo, preventing the same song from different sources appearing twice

### Improved
- **Shutdown now persists player states** — `manager.shutdown()` saves all player states (autoplay, queue, filters) before closing nodes
- **Session resume restores player state** — After session resume, persisted player state (autoplay, history, filters, queue) is automatically restored
- **Autoplay seed pool diversity** — Better cross-artist transitions with improved scoring
- **Node destroy with failover** — `Node.destroy()` attempts to move players to healthy nodes before destroying them

## [1.0.2] - 2026-04-03

### Fixed
- README now renders correctly on npmjs.com

## [1.0.1] - 2026-04-03

### Fixed
- npm registry README propagation issue from initial publish

## [1.0.0] - 2026-04-03

### Added
- **Lavalink v3 + v4 support** — Auto-detects server version on connect and adapts WebSocket URLs, REST endpoints, headers, and player operations automatically
- **Version detection** — `Node.detectVersion()` probes `/v4/info` (v4) then `/version` (v3) before establishing WebSocket connection
- **v3 WebSocket operations** — Player control via WS ops (`play`, `stop`, `pause`, `seek`, `volume`, `filters`, `destroy`, `voiceUpdate`, `configureResuming`) for Lavalink v3
- **v3 response normalization** — Translates v3 `loadtracks` responses (`TRACK_LOADED`, `SEARCH_RESULT`, etc.) into v4 format (`track`, `search`, `playlist`, `empty`, `error`)
- **Session persistence** — `FileSessionStore` saves/restores Lavalink session IDs to a JSON file for seamless bot restart resume
- **Smart autoplay** — Auto-mix engine with transition scoring, multi-seed Spotify recommendations, theme keyword extraction, duration similarity, and history tracking (last 50 tracks)
- **Graceful shutdown** — `manager.shutdown()` persists all session IDs, gracefully closes nodes, flushes stores, and clears caches
- **Heartbeat monitoring** — WebSocket ping/pong at configurable interval to detect dead connections and trigger auto-reconnect
- **LRU search cache** — Bounded cache with TTL, periodic pruning, and memory estimation for search results
- **Search fallback** — Automatic fallback across platforms (e.g., Spotify → SoundCloud → YouTube Music → YouTube)
- **Node selection strategies** — Penalty-based (CPU + frame deficit + player count), least-load, least-players, or priority-based
- **REST resilience** — Auto-retry on 429 rate limits with `Retry-After` header support, GET request deduplication, configurable timeouts
- **Reconnect with backoff** — Exponential backoff with ±25% jitter to prevent thundering herd on mass reconnects
- **Audio filters** — Built-in presets: `bassboost`, `nightcore`, `vaporwave`, `eightD`, `slowmo`, `soft`, `trebleBass`, `tv`, `distort`
- **Voice readiness** — Promise-based `waitForVoiceReady()` ensures voice connection is established before playback
- **Typed events** — Fully typed event emitter via `tiny-typed-emitter` for all manager/node/player events
- **Plugin system** — Extensible via `Plugin` interface for custom structures
- **Queue management** — Extended Array with `add()`, `remove()`, `clear()`, `shuffle()`, `totalSize`, repeat modes
- **Player state snapshots** — `getStateSnapshot()` for debugging and persistence
- **Node info caching** — `fetchInfo()` caches Lavalink server info (version, plugins, source managers)
- **Close code handling** — Fatal codes (4001, 4004) prevent retry; session-invalid codes (4006, 4009) clear session and retry fresh

### Dependencies
- `ws` ^8.18.1
- `tiny-typed-emitter` ^2.1.0

[1.3.0]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.3.0
[1.2.0]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.2.0
[1.1.3]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.1.3
[1.1.2]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.1.2
[1.1.1]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.1.1
[1.1.0]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.1.0
[1.0.2]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.0.2
[1.0.1]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.0.1
[1.0.0]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.0.0
