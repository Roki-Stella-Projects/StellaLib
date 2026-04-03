# Architecture

This document explains how StellaLib is structured internally and how data flows between components.

## Overview

StellaLib sits between your Discord bot and one or more Lavalink servers. It handles all communication, state management, and audio control.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Your Discord Bot                           │
│                                                                     │
│  client.on("raw", d => manager.updateVoiceState(d))                 │
│  manager.on("TrackStart", (player, track) => { ... })               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │    StellaManager     │
                    │                      │
                    │  • nodes: Map        │
                    │  • players: Map      │
                    │  • caches: LRUCache  │
                    │  • sessionStore      │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │  StellaNode  │ │  StellaNode  │ │  StellaNode  │
      │              │ │              │ │              │
      │ • WebSocket  │ │ • WebSocket  │ │ • WebSocket  │
      │ • StellaRest │ │ • StellaRest │ │ • StellaRest │
      │ • version    │ │ • version    │ │ • version    │
      │ • heartbeat  │ │ • heartbeat  │ │ • heartbeat  │
      └──────┬───────┘ └──────────────┘ └──────────────┘
             │
     ┌───────┼───────┐
     ▼       ▼       ▼
┌────────┐┌────────┐┌────────┐
│Player A││Player B││Player C│  (one per Discord guild)
│        ││        ││        │
│• Queue ││• Queue ││• Queue │
│• Filter││• Filter││• Filter│
│• State ││• State ││• State │
└────────┘└────────┘└────────┘
```

## Classes

### StellaManager

The **entry point** and central coordinator. There is exactly **one Manager** per bot.

**Responsibilities:**
- Creates and stores `StellaNode` instances from the `nodes` config
- Creates and stores `StellaPlayer` instances (one per guild)
- Routes incoming Discord voice events to the correct player/node
- Handles track search with platform fallback and caching
- Manages graceful shutdown (persist sessions, close nodes, clear caches)
- Emits all events that your bot listens to

**Key data structures:**
- `nodes: Map<string, StellaNode>` — All Lavalink node connections, keyed by identifier
- `players: Map<string, StellaPlayer>` — All guild players, keyed by guild ID
- `caches: LRUCache` — Search result cache with TTL

### StellaNode

Represents a **single Lavalink server connection**. Each node has its own WebSocket, REST client, and lifecycle.

**Responsibilities:**
- Auto-detects Lavalink version (v3 or v4) before connecting
- Maintains WebSocket connection with heartbeat ping/pong
- Handles reconnection with exponential backoff + jitter
- Manages session resume (loads/saves session IDs via SessionStore)
- Syncs player state after resume (v4 only)
- Routes Lavalink events (track start/end/stuck/error, player update) to the Manager
- Contains the smart autoplay engine

**Lifecycle:**
```
detectVersion() → connect() → open() → handleReady() → [message loop] → close() → reconnect()
                                                                              ↓
                                                                    gracefulClose()
```

### StellaPlayer

Controls audio playback for **one Discord guild**. Created via `manager.create()`.

**Responsibilities:**
- Playback control: play, pause, stop, seek, volume
- Queue management (delegates to `StellaQueue`)
- Voice channel connection and readiness
- Audio filter application (delegates to `StellaFilters`)
- Track repeat and queue repeat modes
- Autoplay toggle
- Node migration (`moveNode()`)

**State machine:**
```
DISCONNECTED → CONNECTING → CONNECTED → PLAYING/PAUSED
      ↑                                        │
      └──────── DESTROYING ◄───────────────────┘
```

### StellaQueue

Extends JavaScript's `Array<Track>` with music-specific methods.

**Key properties:**
- `current` — The track currently playing (not in the array)
- `previous` — The last played track
- `totalSize` — `current` + queue length
- `size` — Queue length (excluding current)

### StellaRest

HTTP client for Lavalink's REST API. Each Node has its own Rest instance.

**Key features:**
- Version-aware endpoints (v3 vs v4 paths)
- For v3: translates REST-style calls into WebSocket operations
- Rate limit retry (429 with `Retry-After` header)
- GET request deduplication (concurrent identical GETs share one promise)
- Configurable timeout via AbortController
- Request/failure counters

### StellaFilters

Manages audio filters for a Player. Each Player has its own Filters instance.

**Key features:**
- Built-in presets (bassboost, nightcore, vaporwave, etc.)
- Custom equalizer bands
- Timescale, rotation, distortion, tremolo, vibrato parameters
- Sends filter updates to Lavalink via the Node's REST client

### LRUCache

Bounded least-recently-used cache with TTL-based expiry.

**Key features:**
- `maxSize` — Evicts oldest entry when full
- `time` — TTL per entry; expired entries are pruned periodically
- `memoryEstimate()` — Rough byte count of cached data
- Used by Manager for search result caching

### FileSessionStore

Persists Lavalink session IDs to a JSON file on disk.

**Interface:**
```ts
interface SessionStore {
  get(nodeId: string): Promise<string | null> | string | null;
  set(nodeId: string, sessionId: string): Promise<void> | void;
  delete(nodeId: string): Promise<void> | void;
}
```

You can implement this interface with Redis, a database, or any other storage.

## Data Flow

### Voice Connection Flow

```
1. User calls player.connect()
2. Player sets state to CONNECTING
3. Manager sends OP 4 (voice state update) to Discord via send()
4. Discord sends back VOICE_STATE_UPDATE and VOICE_SERVER_UPDATE
5. Bot forwards these via client.on("raw", d => manager.updateVoiceState(d))
6. Manager assembles voiceState object and sends to Lavalink via REST/WS
7. Player state becomes CONNECTED
```

### Search Flow

```
1. manager.search("query", userId) is called
2. Manager checks LRU cache for cached result
3. If cache miss, builds search identifier (e.g., "spsearch:query")
4. Sends GET /v4/loadtracks?identifier=... (or /loadtracks for v3)
5. If result is empty/error, tries next platform in searchFallback array
6. Normalizes response to SearchResult format
7. Caches result in LRU cache
8. Returns SearchResult to caller
```

### Playback Flow

```
1. player.queue.add(track) — Track added to queue
2. player.play() — Sends play command to Lavalink
   - v4: REST PATCH /v4/sessions/{sid}/players/{guildId}
   - v3: WS op { op: "play", guildId, track: encoded }
3. Lavalink starts decoding and streaming audio
4. Lavalink sends TrackStartEvent via WebSocket
5. Node receives it → emits TrackStart on Manager
6. When track ends, Lavalink sends TrackEndEvent
7. Node handles it:
   - If queue has more tracks → auto-plays next
   - If repeat mode → replays current or restarts queue
   - If autoplay enabled and queue empty → auto-mix engine finds next track
   - Otherwise → emits QueueEnd
```

### Reconnect Flow

```
1. WebSocket disconnects (close event)
2. Node checks close code:
   - Fatal (4001, 4004): destroy node, no retry
   - Session invalid (4006, 4009): clear sessionId, retry fresh
   - Other: retry with saved sessionId
3. Node schedules reconnect with exponential backoff + jitter
4. On reconnect: detectVersion() → connect() with saved session
5. If resumed (v4): Lavalink sends ready op with resumed=true → syncPlayers()
6. If not resumed: handleReady() creates fresh session → rebuild players
```

## Next Steps

- [Manager](03-manager.md) — Full Manager API
- [Node](04-node.md) — Node lifecycle and configuration
- [Player](05-player.md) — Player API and state management
