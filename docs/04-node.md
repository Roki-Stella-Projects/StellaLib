# Node

`StellaNode` represents a connection to a single Lavalink server. Nodes are created automatically when you pass the `nodes` config to `StellaManager`.

## Configuration

```ts
const manager = new StellaManager({
  nodes: [
    {
      identifier: "main",        // Unique name (default: "host:port")
      host: "localhost",          // Lavalink server host (required)
      port: 2333,                // Lavalink server port (required)
      password: "youshallnotpass",// Lavalink password (required)
      secure: false,             // Use wss:// and https:// (default: false)
      retryAmount: 5,            // Max reconnect attempts (default: 5)
      retryDelay: 5000,          // Base delay between retries in ms (default: 5000)
      requestTimeout: 10000,     // REST request timeout in ms (default: 10000)
      resumeStatus: true,        // Enable session resuming (default: false)
      resumeTimeout: 120,        // Seconds Lavalink holds session (default: 60)
      heartbeatInterval: 30000,  // WS ping interval in ms (default: 30000)
    },
  ],
  // ...
});
```

## Properties

| Property | Type | Description |
|---|---|---|
| `options` | `NodeOptions` | Configuration options for this node |
| `version` | `3 \| 4` | Detected Lavalink version (set after `detectVersion()`) |
| `connected` | `boolean` | Whether the WebSocket is open |
| `stats` | `NodeStats` | CPU, memory, player count, uptime statistics |
| `info` | `LavalinkInfo \| null` | Cached server info (version, plugins, sources) |
| `rest` | `StellaRest` | The REST client for this node |
| `sessionId` | `string \| null` | Current Lavalink session ID |
| `penalties` | `number` | Calculated penalty score for load balancing |
| `manager` | `StellaManager` | Reference to the parent Manager |

## Connection Lifecycle

### 1. Version Detection

Before connecting, the Node probes the Lavalink server to detect its version:

```
GET /v4/info → 200 OK → Lavalink v4 (info is cached)
       ↓ fail
GET /version → 200 OK → Lavalink v3
       ↓ fail
Default to v4
```

### 2. WebSocket Connection

After detection, the Node connects with the correct URL and headers:

**Lavalink v4:**
```
URL: wss://host:port/v4/websocket
Headers:
  Authorization: <password>
  User-Id: <bot user id>
  Client-Name: <client name>
  Session-Id: <saved session id>  (if resuming)
```

**Lavalink v3:**
```
URL: ws://host:port
Headers:
  Authorization: <password>
  Num-Shards: <shard count>
  User-Id: <bot user id>
  Client-Name: <client name>
  Resume-Key: <saved session id>  (if resuming)
```

### 3. Ready / Open

- **v4:** Lavalink sends a `ready` op with `{ sessionId, resumed }`. The Node calls `handleReady()`.
- **v3:** No `ready` op exists. The Node generates a synthetic session ID on WebSocket `open` and calls `handleReady()` immediately.

### 4. Session Resume

In `handleReady()`:
1. Session ID is saved to the SessionStore
2. Resume is configured:
   - **v4:** `PATCH /v4/sessions/{sessionId}` with `{ resuming: true, timeout: N }`
   - **v3:** WS op `configureResuming` with `{ key: sessionId, timeout: N }`
3. If resumed (v4): `syncPlayers()` fetches and rebuilds all player states
4. If not resumed: `rebuildPlayers()` re-sends voice state for existing players

### 5. Message Loop

The Node processes incoming WebSocket messages:

| Op | Description |
|---|---|
| `stats` | Node statistics update (CPU, memory, players, uptime) |
| `playerUpdate` | Player position/state update |
| `event` | Track events (start, end, stuck, exception, WS closed) |
| `ready` | Session ready (v4 only) |

### 6. Heartbeat

If `heartbeatInterval` is set, the Node sends WebSocket pings at that interval:
- If no pong is received → connection is considered dead → `socket.terminate()` → reconnect

### 7. Disconnect & Reconnect

On disconnect:
1. Check close code:
   - **Fatal (4001, 4004):** Node is destroyed, no retry
   - **Session invalid (4006, 4009):** Clear session ID, retry fresh
   - **Other:** Retry with saved session
2. Schedule reconnect with exponential backoff:
   ```
   delay = retryDelay * (2 ^ attempt) * (0.75 to 1.25 random jitter)
   ```
3. After `retryAmount` failures, emit `NodeError` and destroy

### 8. Graceful Close

`node.gracefulClose()` is called during manager shutdown:
1. Persists session ID to SessionStore
2. Stops heartbeat
3. Closes WebSocket cleanly

## Stats

Node stats are updated periodically by Lavalink via the `stats` op:

```ts
interface NodeStats {
  players: number;          // Total connected players
  playingPlayers: number;   // Currently playing players
  uptime: number;           // Node uptime in ms
  memory: {
    free: number;
    used: number;
    allocated: number;
    reservable: number;
  };
  cpu: {
    cores: number;
    systemLoad: number;
    lavalinkLoad: number;
  };
  frameStats: {
    sent?: number;
    nulled?: number;
    deficit?: number;
  };
}
```

## Penalty Scoring

The `penalties` getter calculates a score used for node selection:

```
penalty = cpuPenalty + deficitFramePenalty + nullFramePenalty + playerPenalty
```

Lower penalty = better node. The Manager picks the node with the lowest score when creating a player.

## Server Info

After connection, `fetchInfo()` caches the Lavalink server information:

```ts
// Access after NodeConnect
manager.on("NodeConnect", async (node) => {
  console.log(node.info);
  // {
  //   version: { semver: "4.0.0", major: 4, minor: 0, patch: 0, ... },
  //   buildTime: 1234567890,
  //   git: { branch: "main", commit: "abc123", ... },
  //   jvm: "21.0.1",
  //   lavaplayer: "2.0.0",
  //   sourceManagers: ["youtube", "soundcloud", "spotify", ...],
  //   filters: ["equalizer", "timescale", "rotation", ...],
  //   plugins: [{ name: "...", version: "..." }],
  // }
});
```
