# Multi-Version Support (Lavalink v3 + v4)

StellaLib automatically detects your Lavalink server version and adapts its protocol. No configuration needed.

## Version Detection

Before establishing a WebSocket connection, the Node probes the server:

```
Step 1: GET /v4/info
  → 200 OK → Lavalink v4 detected (server info is cached)
  → Error  → continue to step 2

Step 2: GET /version
  → 200 OK → Lavalink v3 detected
  → Error  → default to v4
```

After detection, `node.version` is set to `3` or `4`.

```ts
manager.on("NodeConnect", (node) => {
  console.log(`Lavalink v${node.version}`); // 3 or 4
});
```

## Protocol Differences

StellaLib handles all of these differences internally. You don't need to worry about them — the same code works for both versions.

### WebSocket Connection

| | Lavalink v3 | Lavalink v4 |
|---|---|---|
| **URL** | `ws://host:port` | `ws://host:port/v4/websocket` |
| **Resume header** | `Resume-Key: <sessionId>` | `Session-Id: <sessionId>` |
| **Ready event** | None (synthetic on open) | `ready` op with `{ sessionId, resumed }` |

### Player Control

| Operation | Lavalink v3 | Lavalink v4 |
|---|---|---|
| **Play** | WS `{ op: "play", guildId, track }` | REST `PATCH /v4/sessions/{sid}/players/{gid}` |
| **Stop** | WS `{ op: "stop", guildId }` | REST `PATCH` with `{ track: { encoded: null } }` |
| **Pause** | WS `{ op: "pause", guildId, pause }` | REST `PATCH` with `{ paused: true/false }` |
| **Seek** | WS `{ op: "seek", guildId, position }` | REST `PATCH` with `{ position: ms }` |
| **Volume** | WS `{ op: "volume", guildId, volume }` | REST `PATCH` with `{ volume: N }` |
| **Filters** | WS `{ op: "filters", guildId, ... }` | REST `PATCH` with `{ filters: { ... } }` |
| **Destroy** | WS `{ op: "destroy", guildId }` | REST `DELETE /v4/sessions/{sid}/players/{gid}` |

### REST Endpoints

| Method | Lavalink v3 | Lavalink v4 |
|---|---|---|
| **Load tracks** | `GET /loadtracks?identifier=...` | `GET /v4/loadtracks?identifier=...` |
| **Decode tracks** | `POST /decodetracks` | `POST /v4/decodetracks` |
| **Server info** | `GET /version` (returns string) | `GET /v4/info` (returns JSON) |
| **Get players** | Not available | `GET /v4/sessions/{sid}/players` |
| **Get player** | Not available | `GET /v4/sessions/{sid}/players/{gid}` |

### Session Resume

| | Lavalink v3 | Lavalink v4 |
|---|---|---|
| **Configure** | WS `{ op: "configureResuming", key, timeout }` | REST `PATCH /v4/sessions/{sid}` with `{ resuming: true, timeout }` |
| **Header** | `Resume-Key: <key>` | `Session-Id: <sessionId>` |
| **Player sync** | Not available | Full player state sync via REST |

### Track Data

| Field | Lavalink v3 | Lavalink v4 |
|---|---|---|
| **Track string** | `track` field | `encoded` field |
| **Load types** | `TRACK_LOADED`, `SEARCH_RESULT`, `PLAYLIST_LOADED`, `NO_MATCHES`, `LOAD_FAILED` | `track`, `search`, `playlist`, `empty`, `error` |

StellaLib normalizes v3 responses to the v4 format, so your code always works with the same structure.

### Player Update Events

| Field | Lavalink v3 | Lavalink v4 |
|---|---|---|
| `state.position` | Always present | Always present |
| `state.time` | Always present | Always present |
| `state.connected` | Not present | Present |
| `state.ping` | Not present | Present |

StellaLib handles missing fields gracefully — `connected` and `ping` are only set if present in the payload.

## What You Need to Know

**Nothing.** That's the whole point. StellaLib handles all version differences internally. Your code is the same whether connecting to a v3 or v4 server:

```ts
// Works identically on both v3 and v4
const player = manager.create({ guild: guildId, voiceChannel: vcId });
player.connect();

const result = await manager.search("never gonna give you up", userId);
player.queue.add(result.tracks[0]);
player.play();

player.setVolume(50);
player.pause(true);
await player.filters.setFilter("nightcore", true);
player.destroy();
```

## v3 Limitations

Some features are only available on Lavalink v4:

| Feature | v3 | v4 |
|---|---|---|
| Player sync on resume | Not available | Full state sync |
| Get all players | Returns empty | Full player list |
| Get single player | Returns null | Full player state |
| Server info | Version string only | Full JSON (plugins, sources, etc.) |

These limitations are handled gracefully — `getAllPlayers()` returns `[]` on v3, `getPlayer()` returns `null`, etc.

## Mixed Version Environments

You can connect to both v3 and v4 nodes simultaneously:

```ts
const manager = new StellaManager({
  nodes: [
    { identifier: "v4-node", host: "v4.example.com", port: 2333, password: "pass" },
    { identifier: "v3-node", host: "v3.example.com", port: 2333, password: "pass" },
  ],
  // ...
});

manager.on("NodeConnect", (node) => {
  console.log(`${node.options.identifier}: Lavalink v${node.version}`);
  // v4-node: Lavalink v4
  // v3-node: Lavalink v3
});
```

Each node independently detects its version and uses the appropriate protocol. Players on different nodes may use different Lavalink versions — StellaLib handles this transparently.
