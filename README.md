<p align="center">
  <h1 align="center">StellaLib</h1>
  <p align="center">A powerful Lavalink v3 + v4 client for TypeScript — with auto version detection, session persistence, smart autoplay, and graceful shutdown.</p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@stella_project/stellalib"><img src="https://img.shields.io/npm/v/@stella_project/stellalib.svg?style=flat-square&color=blue" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@stella_project/stellalib"><img src="https://img.shields.io/npm/dm/@stella_project/stellalib.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-OSL--3.0-blue.svg?style=flat-square" alt="License" /></a>
  <a href="https://github.com/Roki-Stella-Projects/StellaLib"><img src="https://img.shields.io/github/stars/Roki-Stella-Projects/StellaLib?style=flat-square" alt="GitHub stars" /></a>
</p>

---

## Table of Contents

- [What is StellaLib?](#what-is-stellalib)
- [How it Works](#how-it-works)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [Manager](#manager)
  - [Node](#node)
  - [Player](#player)
  - [Queue](#queue)
  - [Rest](#rest)
  - [Filters](#filters)
- [Multi-Version Support (v3 + v4)](#multi-version-support-v3--v4)
- [Session Persistence](#session-persistence)
- [Player State Persistence](#player-state-persistence)
- [Auto-Failover](#auto-failover)
- [Inactivity Timeout](#inactivity-timeout)
- [Queue Limits & Deduplication](#queue-limits--deduplication)
- [Node Health Monitoring](#node-health-monitoring)
- [Zombie Node Detection](#zombie-node-detection)
- [REST Backpressure](#rest-backpressure)
- [Track Serialization (Memory Protection)](#track-serialization-memory-protection)
- [Voice Hot-Swapping](#voice-hot-swapping)
- [Smart Autoplay](#smart-autoplay)
- [Search with Fallback](#search-with-fallback)
- [Audio Filters](#audio-filters)
- [Plugin Support](#plugin-support)
- [Events Reference](#events-reference)
- [Configuration Reference](#configuration-reference)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [Changelog](#changelog)
- [License](#license)

---

## What is StellaLib?

**StellaLib** is a TypeScript client library that connects your Discord bot to [Lavalink](https://github.com/lavalink-devs/Lavalink) — a standalone audio server that handles music playback, search, and streaming. StellaLib manages the entire lifecycle: connecting to Lavalink nodes, creating guild-level players, searching tracks, controlling playback, and handling events.

Unlike other Lavalink clients, StellaLib:

- **Auto-detects** whether your Lavalink server is v3 or v4 and adapts automatically
- **Persists sessions and player state** across bot restarts so music keeps playing — autoplay, queue, filters, and history all survive
- **Has a smart autoplay engine** that picks the best next track based on listening history
- **Auto-failover** — when a node dies, players move to healthy nodes automatically
- **Proactive health monitoring** — detects overloaded nodes and migrates players *before* they crash
- **Zombie node detection** — catches frozen Lavalink processes that pass heartbeat checks but stop sending player updates
- **REST backpressure** — token bucket rate limiter prevents self-DDoS when 100+ users `/play` simultaneously
- **Voice hot-swapping** — silently reconnects voice when Discord rotates servers, instead of dropping audio
- **Memory protection** — compact queue serialization reduces RAM by 50-70% at scale
- **Plugin support** — SponsorBlock, LavaSearch, RoutePlanner, Crossfade, Auto-ducking, and Opus priority
- **Handles failures gracefully** with fast first reconnect, exponential backoff, rate limit retries, and search fallback

## How it Works

```
┌──────────────┐     raw voice events     ┌──────────────────┐     WebSocket/REST     ┌──────────┐
│  Discord.js  │ ──────────────────────► │   StellaManager   │ ◄──────────────────► │ Lavalink │
│   (your bot) │ ◄────── send payloads ── │                    │                       │  Server  │
└──────────────┘                          └──────────────────┘                       └──────────┘
                                                  │
                                    ┌─────────────┼─────────────┐
                                    ▼             ▼             ▼
                              ┌──────────┐ ┌──────────┐ ┌──────────┐
                              │  Node 1  │ │  Node 2  │ │  Node N  │
                              │ (v4 auto)│ │ (v3 auto)│ │          │
                              └──────────┘ └──────────┘ └──────────┘
                                    │
                              ┌─────┼─────┐
                              ▼     ▼     ▼
                          ┌────────┐ ┌────────┐
                          │Player A│ │Player B│  (one per guild)
                          │ Queue  │ │ Queue  │
                          │Filters │ │Filters │
                          └────────┘ └────────┘
```

**Flow:**

1. Your bot receives raw Discord voice events and forwards them to `StellaManager`
2. The Manager routes voice data to the correct `Node` (Lavalink server connection)
3. Each Node auto-detects its Lavalink version (v3 or v4) and adapts its protocol
4. `Player` instances (one per guild) handle playback, queue, volume, and filters
5. The Node's `Rest` client handles track loading, player updates, and session management
6. Events flow back from Lavalink → Node → Manager → your bot's event handlers

## Architecture

StellaLib is composed of several core classes that work together:

| Class | What it does |
|---|---|
| **`StellaManager`** | The entry point. Manages all nodes and players, handles search, voice state updates, caching, and shutdown. You create one Manager per bot. |
| **`StellaNode`** | Represents a connection to a single Lavalink server. Handles WebSocket connection, heartbeat, reconnect, version detection, session resume, and autoplay logic. |
| **`StellaPlayer`** | One player per Discord guild. Controls playback (`play`, `pause`, `stop`, `seek`), manages the queue, applies filters, and handles voice readiness. |
| **`StellaQueue`** | Extends `Array` with music-specific methods: `add()`, `remove()`, `clear()`, `shuffle()`, repeat modes, and `current`/`previous` track tracking. |
| **`StellaRest`** | HTTP client for Lavalink's REST API. Version-aware (v3 vs v4 endpoints), with rate limit retry, request deduplication, and timeout handling. |
| **`StellaFilters`** | Manages audio filters and equalizer settings per player. Built-in presets for common effects. |
| **`LRUCache`** | Bounded least-recently-used cache with TTL expiry for search results. Reduces redundant API calls. |
| **`FileSessionStore`** | Persists Lavalink session IDs **and full player states** to a JSON file. Enables seamless resume after bot restarts — including autoplay, queue, and filters. |

### Project Structure

```
src/
  Structures/
    Manager.ts      — Main hub: nodes, players, search, voice, cache, shutdown
    Node.ts         — Lavalink node: WS, heartbeat, reconnect, version detect, autoplay
    Player.ts       — Guild player: playback, queue, voice ready, filters, move node
    Queue.ts        — Queue: add/remove/shuffle, repeat modes, current/previous
    Rest.ts         — REST client: version-aware endpoints, retry, dedup, timeout
    Filters.ts      — Audio filter management and presets
    LRUCache.ts     — Bounded LRU cache with TTL and memory estimation
    SessionStore.ts — FileSessionStore for session persistence
    Types.ts        — All TypeScript interfaces, types, and event definitions
    Utils.ts        — TrackUtils (build/validate tracks), Structure, Plugin system
  Utils/
    FiltersEqualizers.ts — Equalizer band presets for each filter
    ManagerCheck.ts      — Manager option validation
    NodeCheck.ts         — Node option validation
    PlayerCheck.ts       — Player option validation
  index.ts               — Re-exports everything
```

## Installation

```bash
npm install @stella_project/stellalib
# or
yarn add @stella_project/stellalib
# or
bun add @stella_project/stellalib
```

## Quick Start

```ts
import { Client, GatewayIntentBits } from "discord.js";
import { StellaManager, FileSessionStore } from "@stella_project/stellalib";

// 1. Create your Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 2. Create the StellaLib manager
const manager = new StellaManager({
  nodes: [
    {
      identifier: "main",        // Unique name for this node
      host: "localhost",          // Lavalink server host
      port: 2333,                // Lavalink server port
      password: "youshallnotpass",// Lavalink password
      resumeStatus: true,        // Enable session resuming
      resumeTimeout: 120,        // Seconds Lavalink waits for reconnect
      heartbeatInterval: 30000,  // Ping interval in ms
    },
  ],
  autoPlay: true,                              // Enable autoplay when queue ends
  defaultSearchPlatform: "spotify",            // Default search source
  searchFallback: ["soundcloud", "youtube"],   // Fallback if primary fails
  sessionStore: new FileSessionStore("./sessions.json"), // Persist sessions
  caches: { enabled: true, time: 60000, maxSize: 200 }, // Search cache
  send(id, payload) {
    // Required: how to send voice payloads to Discord
    const guild = client.guilds.cache.get(id);
    if (guild) guild.shard.send(payload);
  },
});

// 3. Forward raw Discord events to StellaLib (required for voice)
client.on("raw", (d) => manager.updateVoiceState(d));

// 4. Initialize manager when bot is ready
client.on("ready", () => {
  console.log(`Bot ready as ${client.user?.tag}`);
  manager.init(client.user!.id);
});

// 5. Handle events
manager.on("NodeConnect", (node) => {
  console.log(`Connected to ${node.options.identifier} (Lavalink v${node.version})`);
});

manager.on("TrackStart", (player, track) => {
  console.log(`Now playing: ${track.title}`);
});

// 6. Play music (example in a command handler)
async function play(guildId: string, voiceChannelId: string, query: string) {
  // Create or get player
  let player = manager.players.get(guildId);
  if (!player) {
    player = manager.create({
      guild: guildId,
      voiceChannel: voiceChannelId,
      textChannel: "TEXT_CHANNEL_ID",
      volume: 50,
      selfDeafen: true,
    });
    player.connect();
  }

  // Search and queue
  const res = await manager.search(query, "USER_ID");
  if (res.tracks.length) {
    player.queue.add(res.tracks[0]);
    if (!player.playing) player.play();
  }
}

// 7. Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await manager.shutdown();
    process.exit(0);
  });
}

client.login("YOUR_BOT_TOKEN");
```

## Core Concepts

### Manager

`StellaManager` is the central hub. You create **one instance** and it manages everything.

```ts
const manager = new StellaManager({
  nodes: [...],          // Array of Lavalink node configs
  send: (id, payload) => { ... }, // How to send to Discord gateway
  autoPlay: true,        // Auto-play next track when queue ends
  defaultSearchPlatform: "spotify",
  searchFallback: ["soundcloud", "youtube music"],
  sessionStore: new FileSessionStore("./sessions.json"),
  caches: { enabled: true, time: 60000, maxSize: 200 },
  clientName: "StellaLib",
  shards: 1,
});

// Initialize after Discord client is ready
manager.init(client.user!.id);
```

**Key methods:**
- `manager.init(clientId)` — Connect all nodes
- `manager.create(options)` — Create a player for a guild
- `manager.get(guildId)` — Get existing player
- `manager.search(query, requester?)` — Search tracks with fallback
- `manager.updateVoiceState(data)` — Forward raw Discord voice events
- `manager.shutdown()` — Gracefully close everything
- `manager.getStats()` — Get node/player/cache statistics

### Node

`StellaNode` represents a single Lavalink server connection. Nodes are created automatically from the `nodes` config.

**What it does automatically:**
- Detects Lavalink version (v3 or v4) before connecting
- Establishes WebSocket with the correct URL and headers
- Sends heartbeat pings to detect dead connections
- Reconnects with exponential backoff + jitter on disconnect
- Configures session resuming (v3: WS op, v4: REST PATCH)
- Syncs player state after resume (v4 only)
- Handles autoplay logic when queue ends

**Properties:**
- `node.version` — Detected Lavalink version (`3` or `4`)
- `node.connected` — Whether WebSocket is open
- `node.stats` — CPU, memory, players, uptime stats
- `node.info` — Cached Lavalink server info (plugins, sources)
- `node.penalties` — Calculated penalty score for load balancing

### Player

`StellaPlayer` controls playback for **one Discord guild**. Created via `manager.create()`.

```ts
const player = manager.create({
  guild: "GUILD_ID",
  voiceChannel: "VOICE_CHANNEL_ID",
  textChannel: "TEXT_CHANNEL_ID",
  volume: 50,
  selfDeafen: true,
});

player.connect();                    // Join voice channel
player.play();                       // Play first track in queue
player.pause(true);                  // Pause
player.pause(false);                 // Resume
player.stop();                       // Stop current track (plays next)
player.seek(30000);                  // Seek to 30 seconds
player.setVolume(80);                // Set volume (0-100)
player.setTrackRepeat(true);         // Repeat current track
player.setQueueRepeat(true);         // Repeat entire queue
player.setAutoplay(true, botUser);   // Enable smart autoplay
player.moveNode("other-node");       // Move to another Lavalink node
player.destroy();                    // Leave channel and clean up
```

### Queue

`StellaQueue` extends JavaScript's `Array` with music-specific helpers:

```ts
player.queue.add(track);            // Add track(s) to end
player.queue.add([track1, track2]); // Add multiple
player.queue.remove(0);             // Remove by index
player.queue.clear();               // Clear all queued tracks
player.queue.shuffle();             // Randomize order
player.queue.current;               // Currently playing track
player.queue.previous;              // Previously played track
player.queue.totalSize;             // current + queued count
player.queue.size;                  // Queued count (excluding current)
```

### Rest

`StellaRest` handles all HTTP communication with Lavalink. It's version-aware — the same method call works for both v3 and v4.

| Method | v3 behavior | v4 behavior |
|---|---|---|
| `loadTracks(id)` | `GET /loadtracks` → normalized | `GET /v4/loadtracks` |
| `updatePlayer(opts)` | WS ops (`play`, `pause`, etc.) | `PATCH /v4/sessions/.../players/...` |
| `destroyPlayer(id)` | WS `destroy` op | `DELETE /v4/sessions/.../players/...` |
| `configureResume(t)` | WS `configureResuming` op | `PATCH /v4/sessions/...` |
| `getInfo()` | `GET /version` | `GET /v4/info` |
| `decodeTracks(arr)` | `POST /decodetracks` | `POST /v4/decodetracks` |

**Built-in resilience:**
- Auto-retry on 429 rate limits (up to 3 retries with `Retry-After`)
- GET request deduplication (concurrent identical GETs share one request)
- Configurable request timeout
- Request/failure counters

### Filters

Built-in audio filter presets:

```ts
await player.filters.setFilter("bassboost", true);
await player.filters.setFilter("nightcore", true);
await player.filters.setFilter("vaporwave", true);
await player.filters.setFilter("eightD", true);
await player.filters.setFilter("slowmo", true);
await player.filters.setFilter("soft", true);
await player.filters.setFilter("trebleBass", true);
await player.filters.setFilter("tv", true);
await player.filters.setFilter("distort", true);

await player.filters.clearFilters(); // Remove all
```

Each preset applies specific equalizer bands, timescale, rotation, or other Lavalink audio parameters.

## Multi-Version Support (v3 + v4)

StellaLib **automatically detects** your Lavalink server version before connecting. No configuration needed.

**How detection works:**
1. Before WebSocket connect, the Node sends `GET /v4/info` to the server
2. If it responds `200 OK` → **Lavalink v4** detected (server info is cached)
3. If it fails, tries `GET /version` → **Lavalink v3** detected
4. Falls back to v4 if both fail

**What adapts automatically:**

| Aspect | Lavalink v3 | Lavalink v4 |
|---|---|---|
| **WebSocket URL** | `ws://host:port` | `ws://host:port/v4/websocket` |
| **Player control** | WebSocket ops (`play`, `stop`, `pause`, `seek`, `volume`, `filters`) | REST `PATCH` |
| **Session resume** | `Resume-Key` header + WS `configureResuming` | `Session-Id` header + REST `PATCH` |
| **Track loading** | `/loadtracks` (response normalized to v4 format) | `/v4/loadtracks` |
| **Server info** | `/version` (returns version string) | `/v4/info` (returns full info JSON) |
| **Player sync** | Not available (v3 limitation) | Full player state sync on resume |
| **Track data** | `track` field → mapped to `encoded` | `encoded` field |
| **Load types** | `TRACK_LOADED` → `track`, `SEARCH_RESULT` → `search`, etc. | Already v4 format |

```ts
manager.on("NodeConnect", (node) => {
  console.log(`Lavalink v${node.version}`); // 3 or 4
});
```

## Session Persistence

StellaLib persists session IDs so music **keeps playing** after bot restarts.

```ts
import { FileSessionStore } from "@stella_project/stellalib";

const manager = new StellaManager({
  sessionStore: new FileSessionStore("./sessions.json"),
  nodes: [{
    resumeStatus: true,    // Tell Lavalink to hold the session
    resumeTimeout: 120,    // Seconds to wait before destroying session
    // ...
  }],
  // ...
});
```

**How it works:**
1. On connect, Node loads saved session ID from the store
2. Sends it as `Session-Id` (v4) or `Resume-Key` (v3) header
3. Lavalink resumes the session — players keep their state
4. On disconnect/shutdown, session ID **and full player state** is persisted to the store
5. On resume, autoplay state, queue, filters, history, and seed pool are all restored

**Custom stores** (e.g., Redis, database):

```ts
const manager = new StellaManager({
  sessionStore: {
    async get(nodeId) { return await redis.get(`session:${nodeId}`); },
    async set(nodeId, sessionId) { await redis.set(`session:${nodeId}`, sessionId); },
    async delete(nodeId) { await redis.del(`session:${nodeId}`); },
  },
  // ...
});
```

## Player State Persistence

StellaLib v1.1.0+ persists **full player state** — not just session IDs — across bot restarts. This means autoplay, queue, filters, repeat modes, and listening history all survive a restart.

```ts
import { FileSessionStore } from "@stella_project/stellalib";

// FileSessionStore automatically handles both session IDs and player states
const manager = new StellaManager({
  sessionStore: new FileSessionStore("./sessions.json"),
  // Player state store is auto-detected from FileSessionStore
  // Or provide a custom one:
  // playerStateStore: myCustomStore,
  // ...
});
```

**What is persisted per player:**
- Autoplay on/off state and bot user ID
- Autoplay history (last 50 tracks) and seed pool
- Queue (all tracks with encoded data)
- Filter configuration and active preset flags
- Repeat modes (track, queue, dynamic)
- Volume, voice channel, text channel

**Custom player state store** (e.g., Redis):

```ts
const manager = new StellaManager({
  playerStateStore: {
    async getPlayerState(guildId) { return JSON.parse(await redis.get(`player:${guildId}`)); },
    async setPlayerState(guildId, state) { await redis.set(`player:${guildId}`, JSON.stringify(state)); },
    async deletePlayerState(guildId) { await redis.del(`player:${guildId}`); },
    async getAllPlayerStates() { /* return all states */ },
  },
  // ...
});
```

## Auto-Failover

When a Lavalink node goes down **mid-playback**, StellaLib **immediately** moves all playing/paused players to a healthy node — audio continues at the exact same position with typically <150ms gap:

```
                    Node A crashes! 💥

  t=0ms    WebSocket close fires
  t=2ms    attemptSeamlessFailover() starts
  t=5ms    Healthy nodes sorted by penalty score
  t=50ms   Voice state sent to Node B
  t=100ms  Track + position + filters sent
  t=150ms  Audio resumes on Node B ♪
```

```
Node A (dies)              Node B (healthy)         Node C (healthy)
  Player 1  ──────────────►  Player 1  ♪
  Player 2  ──────────────►  Player 2  ♪           (load balanced)
  Player 3  ────────────────────────────────────►  Player 3  ♪
```

### Three Layers of Protection

| Layer | Trigger | Speed |
|---|---|---|
| **Seamless failover** | Node unexpectedly disconnects | Immediate (<150ms) |
| **Health monitoring** | CPU/frame deficit exceeds threshold | Proactive (before crash) |
| **Destroy failover** | Node explicitly removed from pool | Immediate |

### PlayerFailover Event

```ts
manager.on("PlayerFailover", (player, oldNode, newNode) => {
  console.log(`Player ${player.guild} moved: ${oldNode} → ${newNode}`);
  // Optionally notify the guild
});
```

- Players are distributed across healthy nodes by **penalty score** (not all dumped on one node)
- If no healthy nodes exist, players wait for reconnect (fast 2s retry on first attempt)
- See [docs/13-seamless-failover.md](docs/13-seamless-failover.md) for full architecture details

## Inactivity Timeout

Auto-disconnect the bot when it's alone in a voice channel:

```ts
const player = manager.create({
  guild: guildId,
  voiceChannel: voiceChannelId,
  inactivityTimeout: 300000, // 5 minutes
});

// In your voiceStateUpdate handler:
client.on("voiceStateUpdate", (oldState, newState) => {
  const player = manager.get(oldState.guild.id);
  if (!player) return;

  const channel = oldState.guild.channels.cache.get(player.voiceChannel!);
  const members = channel?.members?.filter((m) => !m.user.bot).size ?? 0;

  if (members === 0) {
    player.startInactivityTimer();  // Start countdown
  } else {
    player.stopInactivityTimer();   // Cancel — someone joined
  }
});
```

## Queue Limits & Deduplication

### Max Queue Size

Prevent memory abuse by limiting the queue:

```ts
const player = manager.create({
  guild: guildId,
  voiceChannel: voiceChannelId,
  maxQueueSize: 500, // Max 500 tracks in queue
});

// Check before adding
if (!player.canAddToQueue(tracks.length)) {
  return message.reply(`Queue is full! Only ${player.queueSpaceRemaining} slots left.`);
}
player.queue.add(tracks); // Excess tracks are automatically truncated
```

### Track Deduplication

Prevent the same song from being queued twice:

```ts
player.queue.noDuplicates = true;

// Now queue.add() silently skips tracks that are already queued
player.queue.add(track); // Added
player.queue.add(track); // Silently skipped (same URI)

// Check manually:
if (player.queue.isDuplicate(track)) {
  return message.reply("That track is already in the queue!");
}
```

## Node Health Monitoring

StellaLib can proactively monitor node health and migrate players **before** a node crashes:

```ts
const manager = new StellaManager({
  nodeHealthThresholds: {
    maxCpuLoad: 0.85,       // Migrate when CPU exceeds 85%
    maxFrameDeficit: 300,   // Migrate when frame deficit exceeds 300
    checkInterval: 30000,   // Check every 30 seconds
  },
  // ...
});
```

```
         Health Check (every 30s)
               │
    Node A: CPU 92% ──► OVERLOADED
    Node B: CPU 40% ──► healthy
               │
    Migrate players A → B (preemptive)
```

This is **proactive** failover — it moves players before they experience audio issues, unlike the reactive auto-failover which only triggers when a node dies.

## Zombie Node Detection

A Lavalink process can freeze internally (deadlock, GC pause, thread starvation) while its TCP connection stays alive — heartbeat pings still return, but `playerUpdate` messages stop. Players hear silence with no errors. StellaLib detects this:

```ts
const manager = new StellaManager({
  zombieDetection: {
    enabled: true,         // Default: true
    checkInterval: 20000,  // Check every 20 seconds
    maxSilence: 30000,     // Flag as zombie after 30s without playerUpdate
  },
  // ...
});

manager.on("NodeZombie", (node, playersAffected, lastUpdate) => {
  console.log(`🧟 Node ${node.options.identifier} is zombie! ${playersAffected} players affected`);
});
```

```
         Zombie Detection (every 20s)
               │
    Node A: last playerUpdate 45s ago, 3 playing players ──► ZOMBIE!
    Node B: last playerUpdate 2s ago ──► healthy
               │
    Move 3 players A → B, terminate A's socket → triggers reconnect
```

**How it works:**
1. Every `playerUpdate` WebSocket message updates `node.lastPlayerUpdate` timestamp
2. The Manager checks all connected nodes every 20s (configurable)
3. If a node has playing players but no `playerUpdate` in 30s → zombie
4. Players are seamlessly moved to healthy (non-zombie) nodes
5. The zombie node's socket is terminated, triggering the reconnect cycle
6. If no healthy nodes exist, the zombie socket is terminated to force reconnect

## REST Backpressure

When 100+ users run `/play` simultaneously, StellaLib can fire hundreds of REST requests at Lavalink in milliseconds. This causes 429 rate limits or even crashes. The token bucket rate limiter prevents this:

```ts
const manager = new StellaManager({
  restBackpressure: {
    enabled: true,
    maxRequestsPerSecond: 20,  // Sustained rate cap
    bucketSize: 40,            // Burst allowance
  },
  // ...
});

// Monitor queue depth
const stats = manager.getStats();
for (const node of stats.nodes) {
  console.log(`Node ${node.identifier}: ${node.restRequests} requests, pending: ...`);
}
```

**How the token bucket works:**
- The bucket starts full with `bucketSize` tokens (default: 40)
- Each REST request consumes 1 token
- Tokens refill at `maxRequestsPerSecond` rate (default: 20/s)
- If the bucket is empty, requests wait in a FIFO queue until a token is available
- Bursts are allowed (up to 40 requests instantly), but sustained rate is capped at 20/s

```
  Burst of 50 requests arrives:
    [1-40] → sent immediately (bucket had 40 tokens)
    [41-50] → queued, released at ~50ms intervals (20/s)
```

## Track Serialization (Memory Protection)

At scale (700+ servers, 50-track queues), each guild's queue holds full Track objects with artwork URLs, plugin metadata, ISRC codes, and custom data. This wastes RAM. `compactQueue()` strips heavy metadata, keeping only what Lavalink needs:

```ts
// Compact the queue to save memory
const compacted = player.queue.compactQueue();
console.log(`Compacted ${compacted} tracks`);

// Monitor memory usage
console.log(`Queue RAM: ~${(player.queue.memoryEstimate / 1024).toFixed(1)} KB`);

// Check if a specific track is compacted
if (StellaQueue.isCompacted(player.queue[0])) {
  console.log("Track is in compact form");
}
```

**What's kept (playback essentials):**
- `track` (base64 encoded — the only thing Lavalink needs)
- `title`, `author`, `duration`, `uri`, `sourceName`, `identifier`
- `requester`, `isSeekable`, `isStream`

**What's stripped (heavy metadata):**
- `pluginInfo` (album art URLs, artist URLs, preview URLs)
- `customData` (user-attached data)
- `artworkUrl`, `thumbnail`, `isrc`

**Typical savings:** A 50-track queue drops from ~120KB to ~35KB per guild (~70% reduction).

## Voice Hot-Swapping

Discord periodically rotates voice servers (code 4015) or UDP connections desync (code 4000). Without handling, the player goes silent at 0:00 with no errors. StellaLib now silently re-identifies:

```ts
manager.on("VoiceReconnect", (player, code) => {
  console.log(`🔄 Player ${player.guild} voice re-identified after code ${code}`);
});
```

**How it works:**
1. `socketClosed` event fires with code 4015 or 4000
2. Instead of cleaning up, StellaLib calls `player.reconnectVoice()`
3. A fresh voice state is sent to Discord (re-identify)
4. Discord responds with new token + endpoint
5. Playback resumes at the current position (~1s gap)

**Close code handling:**

| Code | Meaning | Action |
|---|---|---|
| **4000** | Unknown error (UDP desync) | Auto-reconnect voice |
| **4006** | Session invalid | Try reconnect, fall back to cleanup |
| **4014** | Disconnected (kicked from VC) | Clean up player |
| **4015** | Voice server changed | Auto-reconnect voice |

```ts
// You can also manually trigger a voice reconnect:
await player.reconnectVoice();
```

## Smart Autoplay

When the queue ends and autoplay is enabled, StellaLib's auto-mix engine picks the best next track.

```ts
player.setAutoplay(true, client.user);

// Disabling clears history, seed pool, and anchor so the next session starts fresh
player.setAutoplay(false, client.user);
```

**How the engine works:**

1. **Anchor + seed collection** — The very first track is saved as the **anchor** (permanent style reference). The last 5 played tracks form the rolling seed pool for context
2. **Source detection** — Identifies if the listener was on Spotify, YouTube, or SoundCloud
3. **Recommendation fetch** — Uses Spotify `sprec:` (seed artists + seed tracks) or YouTube Mix
4. **Candidate scoring** — Each candidate is scored on:
   - Duration similarity to recent tracks
   - Author/title keyword overlap with the **previous** track
   - **Anchor similarity** — scored against the original first track to prevent long-term style drift
   - **Seed-pool-wide author affinity** — bonus if the artist appears anywhere in the last 5 seeds
   - History check (never replays last 50 tracks)
5. **Best transition** — Picks the highest-scoring candidate
6. **Cross-platform mirror** — If needed, re-searches on SoundCloud/YouTube for a streamable version
7. **Smart search queries** — Author-only searches are skipped for short/generic names (≤5 chars). `author + title keywords` is always tried first to avoid generic search pollution
8. **Fallback chain** — If recommendations fail, tries theme-based search, then YouTube with title context

## Search with Fallback

```ts
const manager = new StellaManager({
  defaultSearchPlatform: "spotify",
  searchFallback: ["soundcloud", "youtube music", "youtube"],
  // ...
});

// Searches Spotify first. If empty, tries SoundCloud, then YouTube Music, then YouTube.
const result = await manager.search("natori セレナーデ", userId);
```

**Supported platforms:** `spotify`, `soundcloud`, `youtube`, `youtube music`, `deezer`, `tidal`, `applemusic`, `bandcamp`, `jiosaavn`

## Audio Filters

| Filter | Effect |
|---|---|
| `bassboost` | Boosts low frequencies |
| `nightcore` | Speeds up + higher pitch |
| `vaporwave` | Slows down + lower pitch |
| `eightD` | Rotating stereo panning |
| `slowmo` | Slower playback speed |
| `soft` | Reduces harsh frequencies |
| `trebleBass` | Boosts both high and low bands |
| `tv` | Tinny speaker simulation |
| `distort` | Audio distortion effect |

## Plugin Support

### SponsorBlock (requires [SponsorBlock plugin](https://github.com/topi314/Sponsorblock-Plugin))

Auto-skip sponsor segments, intros, outros, and more:

```ts
// Enable SponsorBlock for a player
await player.setSponsorBlock(["sponsor", "selfpromo", "intro", "outro"]);

// Get current segments
const segments = await player.getSponsorBlock();

// Disable
await player.clearSponsorBlock();

manager.on("SegmentSkipped", (player, segment) => {
  console.log(`Skipped ${segment.category} segment (${segment.start}ms - ${segment.end}ms)`);
});
```

### LavaSearch (requires [LavaSearch plugin](https://github.com/topi314/LavaSearch))

Structured search returning tracks, albums, artists, playlists, and text suggestions:

```ts
const results = await manager.lavaSearch({
  query: "natori",
  types: ["track", "album", "artist"],
  source: "spsearch",
});

console.log(results.tracks);    // Track[]
console.log(results.albums);    // Album[]
console.log(results.artists);   // Artist[]
```

### RoutePlanner API

IP rotation management for anti-429 monitoring:

```ts
const status = await manager.getRoutePlannerStatus();
await manager.freeRoutePlannerAddress("1.2.3.4");
await manager.freeAllRoutePlannerAddresses();
```

### Crossfade

Smooth volume fade-out transitions between tracks:

```ts
player.setCrossfade(3000); // 3 second crossfade

manager.on("CrossfadeStart", (player, currentTrack, nextTrack) => {
  console.log(`Crossfading: ${currentTrack.title} → ${nextTrack.title}`);
});
```

### Auto-Ducking

Temporarily reduce music volume during TTS or voice announcements:

```ts
player.duck(10);     // Reduce to volume 10
// ... play TTS ...
player.unduck();     // Restore original volume

console.log(player.isDucked); // true/false
```

### Opus Priority

Prefer Opus-native sources (SoundCloud, YouTube Music) in search results to reduce Lavalink CPU:

```ts
const manager = new StellaManager({
  opusPriority: true, // Opus-native sources appear first in search results
  // ...
});
```

## Events Reference

| Event | Parameters | Description |
|---|---|---|
| `NodeCreate` | `(node)` | Node instance created |
| `NodeConnect` | `(node)` | WebSocket connection established |
| `NodeReconnect` | `(node)` | Attempting reconnection |
| `NodeDisconnect` | `(node, reason)` | WebSocket disconnected |
| `NodeDestroy` | `(node)` | Node destroyed |
| `NodeError` | `(node, error)` | Error on node |
| `NodeRaw` | `(payload)` | Raw WebSocket message |
| `NodeZombie` | `(node, playersAffected, lastUpdate)` | Node detected as zombie (frozen) |
| `TrackStart` | `(player, track, payload)` | Track started playing |
| `TrackEnd` | `(player, track, payload)` | Track finished |
| `TrackStuck` | `(player, track, payload)` | Track got stuck |
| `TrackError` | `(player, track, payload)` | Track playback error |
| `QueueEnd` | `(player, track, payload)` | Queue finished (all tracks played) |
| `PlayerCreate` | `(player)` | Player created for a guild |
| `PlayerDestroy` | `(player)` | Player destroyed |
| `PlayerMove` | `(player, oldChannel, newChannel)` | Bot moved to different voice channel |
| `PlayerDisconnect` | `(player, oldChannel)` | Bot disconnected from voice |
| `PlayerStateUpdate` | `(oldPlayer, newPlayer)` | Player state changed |
| `PlayerFailover` | `(player, oldNode, newNode)` | Player seamlessly moved to a new node |
| `SocketClosed` | `(player, payload)` | Discord voice WebSocket closed for player |
| `SegmentSkipped` | `(player, segment)` | SponsorBlock segment auto-skipped |
| `CrossfadeStart` | `(player, currentTrack, nextTrack)` | Crossfade transition started |
| `VoiceReconnect` | `(player, code)` | Voice connection silently re-identified |
| `Debug` | `(message)` | Debug log message |

## Configuration Reference

### Manager Options

```ts
interface ManagerOptions {
  nodes: NodeOptions[];                  // Lavalink server configs (required)
  send: (id: string, payload: Payload) => void; // Discord gateway send (required)
  clientId?: string;                     // Bot user ID (set by init())
  clientName?: string;                   // Client identifier sent to Lavalink
  shards?: number;                       // Shard count
  autoPlay?: boolean;                    // Enable autoplay on queue end
  defaultSearchPlatform?: SearchPlatform;// Default search source
  searchFallback?: string[];             // Fallback platforms
  opusPriority?: boolean;               // Prefer Opus-native sources in search results
  sessionStore?: SessionStore;           // Session persistence store
  playerStateStore?: PlayerStateStore;   // Full player state persistence
  nodeHealthThresholds?: {               // Proactive node health monitoring
    maxCpuLoad?: number;                 // Max CPU load (0-1), default: 0.9
    maxFrameDeficit?: number;            // Max frame deficit, default: 500
    checkInterval?: number;              // Check interval (ms), default: 60000
  };
  zombieDetection?: {                    // Frozen node detection
    enabled?: boolean;                   // Default: true
    checkInterval?: number;              // Check interval (ms), default: 20000
    maxSilence?: number;                 // Max silence before zombie flag (ms), default: 30000
  };
  restBackpressure?: {                   // REST rate limiting (token bucket)
    enabled?: boolean;                   // Default: false
    maxRequestsPerSecond?: number;       // Sustained rate cap, default: 20
    bucketSize?: number;                 // Burst allowance, default: 40
  };
  caches?: {
    enabled: boolean;
    time: number;                        // TTL in ms
    maxSize: number;                     // Max cached entries
  };
  plugins?: Plugin[];                    // Custom plugins
}
```

### Node Options

```ts
interface NodeOptions {
  host: string;              // Lavalink host
  port: number;              // Lavalink port
  password: string;          // Lavalink password
  identifier?: string;       // Unique node name
  secure?: boolean;          // Use wss:// and https://
  retryAmount?: number;      // Max reconnect attempts
  retryDelay?: number;       // Base delay between retries (ms)
  requestTimeout?: number;   // REST request timeout (ms)
  resumeStatus?: boolean;    // Enable session resuming
  resumeTimeout?: number;    // Seconds Lavalink holds session
  heartbeatInterval?: number;// WebSocket ping interval (ms)
}
```

### Player Options

```ts
interface PlayerOptions {
  guild: string;                 // Guild ID (required)
  voiceChannel?: string;         // Voice channel ID
  textChannel?: string;          // Text channel ID
  node?: string;                 // Preferred node identifier
  volume?: number;               // Initial volume (default: 11)
  selfMute?: boolean;            // Self mute in voice
  selfDeafen?: boolean;          // Self deafen in voice
  inactivityTimeout?: number;    // Auto-disconnect when alone (ms, 0=disabled)
  maxQueueSize?: number;         // Max queue tracks (0=unlimited)
}
```

## Requirements

- **Node.js** >= 18.0.0
- **Lavalink** v3.x or v4.x
- **Discord.js** v14+ (or any library that exposes raw gateway events)

## Documentation

For detailed guides and API reference, see the [docs/](docs/) folder:

- [Getting Started](docs/01-getting-started.md)
- [Architecture](docs/02-architecture.md)
- [Manager](docs/03-manager.md)
- [Node](docs/04-node.md)
- [Player](docs/05-player.md)
- [Queue](docs/06-queue.md)
- [Events](docs/07-events.md)
- [Filters](docs/08-filters.md)
- [Session Persistence](docs/09-session-persistence.md)
- [Multi-Version Support](docs/10-multi-version.md)
- [Autoplay Engine](docs/11-autoplay.md)
- [Player State Persistence](docs/12-player-state-persistence.md)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed list of changes per version.

## Credits

StellaLib stands on the shoulders of these amazing projects:

| Project | Description | Link |
|---|---|---|
| **Lavalink** | The audio server that powers everything | [GitHub](https://github.com/lavalink-devs/Lavalink) · [Website](https://lavalink.dev/) |
| **LithiumX** | Direct upstream — StellaLib is derived from LithiumX by Anantix Network (MIT) | [GitHub](https://github.com/anantix-network/LithiumX) |
| **Erela.js** | Pioneered the Lavalink client pattern in the JS ecosystem — many design patterns originated here | [GitHub](https://github.com/MenuDocs/erela.js) |
| **MagmaStream** | Inspiration for advanced features like improved node management and audio quality | [GitHub](https://github.com/Magmastream-NPM/magmastream) |

Thank you to all the maintainers and contributors of these projects for making music bots possible.

## License

**StellaLib** is licensed under the [Open Software License v3.0 (OSL-3.0)](LICENSE).

Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel

### Upstream License (MIT)

StellaLib is a derivative work based on [LithiumX](https://github.com/anantix-network/LithiumX) by Anantix Network. The original LithiumX code is Copyright (c) 2025 Anantix Network and was released under the **MIT License**.

In compliance with the MIT License, the original copyright and permission notices are preserved in:

- [LICENSE](LICENSE) — Contains both the OSL-3.0 text and the upstream MIT notice
- [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) — Full details of derived components and the complete MIT license text
- Every derived source file carries a `@license` header attributing both copyrights

Recipients of this software receive rights under **both** licenses: OSL-3.0 for StellaLib's original contributions, and MIT for the LithiumX-derived portions.
