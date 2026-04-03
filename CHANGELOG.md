# Changelog

All notable changes to StellaLib will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.2]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.1.2
[1.1.1]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.1.1
[1.1.0]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.1.0
[1.0.2]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.0.2
[1.0.1]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.0.1
[1.0.0]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.0.0
