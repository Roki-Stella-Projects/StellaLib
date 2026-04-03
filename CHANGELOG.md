# Changelog

All notable changes to StellaLib will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.2]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.0.2
[1.0.1]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.0.1
[1.0.0]: https://github.com/Roki-Stella-Projects/StellaLib/releases/tag/v1.0.0
