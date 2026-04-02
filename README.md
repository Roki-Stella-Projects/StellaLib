# StellaLib

A powerful, modern Lavalink client library for TypeScript/JavaScript with auto version detection (v3 + v4), session persistence, smart autoplay, and graceful shutdown.

[![npm version](https://img.shields.io/npm/v/stellalib.svg)](https://www.npmjs.com/package/stellalib)
[![License: OSL-3.0](https://img.shields.io/badge/License-OSL--3.0-blue.svg)](LICENSE)

## Features

- **Lavalink v3 + v4** — Auto-detects server version and adapts protocol automatically
- **Session Persistence** — Save/restore session IDs across bot restarts with `FileSessionStore`
- **Smart Autoplay** — Auto-mix engine with transition scoring, multi-seed recommendations, and history tracking
- **Graceful Shutdown** — Persist sessions, close nodes cleanly, and flush stores on SIGINT/SIGTERM
- **Voice Readiness** — Promise-based voice connection waiting before playback
- **Audio Filters** — Built-in presets: bassboost, nightcore, vaporwave, 8D, slowmo, and more
- **Search Caching** — LRU cache with TTL for search results to reduce API calls
- **Search Fallback** — Automatic fallback across platforms (Spotify → SoundCloud → YouTube)
- **Node Selection** — Penalty-based, least-load, least-players, or priority-based node selection
- **Heartbeat** — WebSocket ping/pong to detect dead connections and auto-reconnect
- **REST Resilience** — Auto-retry on 429 rate limits, GET deduplication, request timeouts
- **Reconnect** — Exponential backoff with jitter to prevent thundering herd
- **Plugin System** — Extensible via plugins
- **Typed Events** — Fully typed event emitter for all manager events
- **Strict TypeScript** — Written with strict TypeScript

## Installation

```bash
npm install stellalib
# or
yarn add stellalib
# or
bun add stellalib
```

## Quick Start

```ts
import { Client, GatewayIntentBits } from "discord.js";
import { StellaManager, FileSessionStore } from "stellalib";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const manager = new StellaManager({
  nodes: [
    {
      identifier: "main",
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
      resumeStatus: true,
      resumeTimeout: 120,
      heartbeatInterval: 30000,
    },
  ],
  autoPlay: true,
  defaultSearchPlatform: "spotify",
  searchFallback: ["soundcloud", "youtube music", "youtube"],
  sessionStore: new FileSessionStore("./sessions.json"),
  caches: { enabled: true, time: 60000, maxSize: 200 },
  send(id, payload) {
    const guild = client.guilds.cache.get(id);
    if (guild) guild.shard.send(payload);
  },
});

// Forward raw Discord events to StellaLib
client.on("raw", (d) => manager.updateVoiceState(d));

client.on("ready", () => {
  console.log(`Bot ready as ${client.user?.tag}`);
  manager.init(client.user!.id);
});

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await manager.shutdown();
    process.exit(0);
  });
}

// Play a track
manager.on("NodeConnect", async () => {
  const player = manager.create({
    guild: "GUILD_ID",
    voiceChannel: "VOICE_CHANNEL_ID",
    textChannel: "TEXT_CHANNEL_ID",
  });
  player.connect();

  const res = await manager.search("never gonna give you up");
  if (res.tracks.length) {
    player.queue.add(res.tracks[0]);
    player.play();
  }
});

client.login("YOUR_BOT_TOKEN");
```

## Session Persistence

StellaLib can persist Lavalink session IDs across bot restarts, so players keep playing without interruption:

```ts
import { FileSessionStore } from "stellalib";

const manager = new StellaManager({
  sessionStore: new FileSessionStore("./sessions.json"),
  nodes: [{
    resumeStatus: true,
    resumeTimeout: 120, // seconds Lavalink waits for reconnect
    // ...
  }],
  // ...
});

// On shutdown, sessions are saved automatically
await manager.shutdown();
```

You can also implement your own store (e.g., Redis) by implementing the `SessionStore` interface:

```ts
interface SessionStore {
  get(nodeId: string): Promise<string | null> | string | null;
  set(nodeId: string, sessionId: string): Promise<void> | void;
  delete(nodeId: string): Promise<void> | void;
}
```

## Smart Autoplay

When the queue ends and autoplay is enabled, StellaLib's auto-mix engine finds the best next track:

```ts
// Enable autoplay for a player
player.setAutoplay(true, { id: user.id, tag: user.tag });
```

The engine scores candidates based on:
- **Duration similarity** — Prefer tracks close in length to recent plays
- **Author/title overlap** — Prioritize same artist or related keywords
- **Source consistency** — Stay on the same platform when possible
- **Diversity** — Avoid repeating the same artist too many times
- **History tracking** — Never replay recently heard tracks (last 50)

Uses multi-seed context from the last 5 tracks for Spotify recommendations, theme keyword extraction, and cross-artist transitions.

## Search with Fallback

```ts
const manager = new StellaManager({
  defaultSearchPlatform: "spotify",
  searchFallback: ["soundcloud", "youtube music", "youtube"],
  // ...
});

// If Spotify returns empty, automatically tries SoundCloud, then YouTube Music, then YouTube
const result = await manager.search("natori セレナーデ");
```

## Audio Filters

```ts
// Toggle filters
await player.filters.setFilter("nightcore", true);
await player.filters.setFilter("bassboost", true);
await player.filters.setFilter("vaporwave", true);
await player.filters.setFilter("eightD", true);

// Clear all filters
await player.filters.clearFilters();
```

Available: `bassboost`, `nightcore`, `vaporwave`, `eightD`, `slowmo`, `soft`, `trebleBass`, `tv`, `distort`

## Manager Stats

```ts
const stats = manager.getStats();
// { nodes, players, playingPlayers, cacheSize, cacheMemoryEstimate }
```

## Events

```ts
manager.on("NodeConnect", (node) => { });
manager.on("NodeDisconnect", (node, reason) => { });
manager.on("NodeError", (node, error) => { });
manager.on("NodeReconnect", (node) => { });
manager.on("NodeRaw", (payload) => { });
manager.on("TrackStart", (player, track, payload) => { });
manager.on("TrackEnd", (player, track, payload) => { });
manager.on("TrackStuck", (player, track, payload) => { });
manager.on("TrackError", (player, track, payload) => { });
manager.on("QueueEnd", (player, track, payload) => { });
manager.on("SocketClosed", (player, payload) => { });
manager.on("PlayerCreate", (player) => { });
manager.on("PlayerDestroy", (player) => { });
manager.on("PlayerMove", (player, oldChannel, newChannel) => { });
manager.on("PlayerDisconnect", (player, oldChannel) => { });
manager.on("PlayerStateUpdate", (oldPlayer, newPlayer) => { });
manager.on("Debug", (message) => { });
```

## Project Structure

```
src/
  Structures/
    Manager.ts      — Main hub: manages nodes, players, search, voice updates
    Node.ts         — Lavalink node: WebSocket, reconnect, session resume, autoplay
    Player.ts       — Guild player: playback, queue, voice readiness, filters
    Queue.ts        — Queue: extends Array with add/remove/shuffle
    Rest.ts         — REST client with retry, timeout, and deduplication
    Filters.ts      — Audio filters and presets
    LRUCache.ts     — Bounded LRU cache with TTL
    SessionStore.ts — FileSessionStore for session persistence
    Types.ts        — All TypeScript interfaces and types
    Utils.ts        — TrackUtils, Structure, Plugin helpers
  Utils/
    FiltersEqualizers.ts — Equalizer band presets
    ManagerCheck.ts      — Manager option validation
    NodeCheck.ts         — Node option validation
    PlayerCheck.ts       — Player option validation
  index.ts               — Re-exports everything
```

## Multi-Version Support

StellaLib auto-detects your Lavalink server version on connect and adapts:

| Feature | Lavalink v3 | Lavalink v4 |
|---|---|---|
| **WebSocket URL** | `ws://host:port` | `ws://host:port/v4/websocket` |
| **Player ops** | WebSocket ops (`play`, `stop`, `pause`, etc.) | REST PATCH |
| **Session resume** | `Resume-Key` header + WS `configureResuming` | `Session-Id` header + REST PATCH |
| **Load tracks** | `/loadtracks` (normalized to v4 format) | `/v4/loadtracks` |
| **Server info** | `/version` | `/v4/info` |
| **Player sync** | Not available | Full player state sync |

```ts
// No configuration needed — version is auto-detected
const manager = new StellaManager({
  nodes: [{ host: "my-v3-server.com", port: 2333 }],
  // ...
});

// Check detected version after connect
manager.on("NodeConnect", (node) => {
  console.log(`Connected to Lavalink v${node.version}`); // 3 or 4
});
```

## Requirements

- **Node.js** >= 18.0.0
- **Lavalink** v3.x or v4.x

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
