# Infrastructure Resilience

StellaLib v1.3.0 introduces four infrastructure-level upgrades designed for high-priority, 700+ server production bots. These features move beyond "features" into internal engineering — catching silent failures, preventing self-DDoS, reducing memory pressure, and recovering from Discord voice rotations automatically.

## Overview

| Feature | Prevents | Trigger | Impact |
|---|---|---|---|
| **Zombie Node Detection** | Silent audio freeze | Node stops sending `playerUpdate` | Players moved to healthy nodes |
| **REST Backpressure** | 429 rate limits / Lavalink crash | Burst of REST requests | Requests queued, released at safe rate |
| **Track Serialization** | OOM kills / memory bloat | Large queues at scale | 50-70% RAM reduction per queue |
| **Voice Hot-Swapping** | "Stuck at 0:00" silence | Discord voice server rotation | Silent re-identify, ~1s gap |

---

## Zombie Node Detection

### The Problem

A Lavalink process can freeze internally (JVM deadlock, long GC pause, thread starvation) while its TCP connection stays alive. WebSocket heartbeat pings still return `pong`, but the process has stopped doing actual work. The symptom: players hear silence, `playerUpdate` messages stop, but no disconnect event fires. Without detection, this is an invisible failure.

### How StellaLib Detects It

1. Every `playerUpdate` WebSocket message from Lavalink updates `node.lastPlayerUpdate` (timestamp)
2. The Manager runs `checkZombieNodes()` on a configurable interval (default: every 20 seconds)
3. For each connected node that has **playing players**, it checks: has a `playerUpdate` arrived within `maxSilence` ms?
4. If not → the node is flagged as **zombie**

### What Happens on Detection

```
  t=0s     Node A stops sending playerUpdates (frozen)
  t=20s    checkZombieNodes() runs — Node A: last update 20s ago, 3 playing players
  t=20s    Not yet zombie (maxSilence = 30s)
  t=40s    checkZombieNodes() runs — Node A: last update 40s ago → ZOMBIE!
  t=40s    3 players moved to Node B (seamless failover)
  t=40s    Node A's socket terminated → triggers reconnect cycle
  t=42s    Node A reconnects (fresh connection)
```

1. **`NodeZombie` event** emitted with `(node, playersAffected, lastUpdate)`
2. **Players seamlessly moved** to healthy (non-zombie) nodes via `player.moveNode()`
3. **Zombie socket terminated** — this triggers the normal reconnect cycle, giving Lavalink a chance to recover
4. If **no healthy nodes** exist, the zombie socket is still terminated to force a reconnect

### Configuration

```ts
const manager = new StellaManager({
  zombieDetection: {
    enabled: true,         // Default: true
    checkInterval: 20000,  // How often to check (ms). Default: 20000 (20s)
    maxSilence: 30000,     // Max time without playerUpdate (ms). Default: 30000 (30s)
  },
});
```

### Grace Period

- Nodes that have **never** received a `playerUpdate` (freshly connected) are given a grace period equal to `maxSilence` from their first heartbeat acknowledgment
- Nodes with **no playing players** are never flagged (no `playerUpdate` expected)
- Detection only considers nodes that are **connected** (WebSocket OPEN)

### Monitoring

```ts
// Check a node's last update timestamp
for (const node of manager.nodes.values()) {
  const silence = Date.now() - node.lastPlayerUpdate;
  console.log(`${node.options.identifier}: last update ${silence}ms ago`);
}

// Listen for zombie events
manager.on("NodeZombie", (node, playersAffected, lastUpdate) => {
  // Alert your monitoring system
  alertOps(`Zombie node ${node.options.identifier}: ${playersAffected} players affected`);
});
```

---

## REST Backpressure (Token Bucket)

### The Problem

When 100+ users run `/play` simultaneously (e.g., after a bot restart or event), StellaLib fires hundreds of `loadtracks` and `updatePlayer` REST requests at Lavalink within milliseconds. Lavalink's HTTP server can't keep up, responding with 429 rate limits or even crashing under the load.

### How StellaLib Prevents It

A **token bucket** rate limiter sits in front of every REST request:

```
  Token Bucket (size: 40, refill: 20/sec)
  ─────────────────────────────────────────
  [████████████████████████████████████████]  ← 40 tokens (full)
  
  Burst of 50 requests:
  [1-40] → sent immediately (40 tokens consumed)
  [                                        ]  ← 0 tokens (empty)
  [41-50] → queued, waiting for refill
  
  After 500ms (10 tokens refilled):
  [██████████                              ]  ← 10 tokens
  [41-50] → sent (10 tokens consumed)
```

### Configuration

```ts
const manager = new StellaManager({
  restBackpressure: {
    enabled: true,
    maxRequestsPerSecond: 20,  // Sustained rate cap (tokens refilled per second)
    bucketSize: 40,            // Maximum burst size (initial tokens)
  },
});
```

### How It Works

1. The bucket starts full with `bucketSize` tokens
2. Each REST request must **acquire** a token before sending
3. If a token is available → request fires immediately
4. If the bucket is empty → request waits in a FIFO queue
5. Tokens refill continuously at `maxRequestsPerSecond` rate
6. Queued requests are drained as tokens become available

### Monitoring

```ts
// Check how many requests are waiting
for (const node of manager.nodes.values()) {
  console.log(`${node.options.identifier}: ${node.rest.pendingRequests} requests queued`);
}
```

### Tuning

| Bot Size | `maxRequestsPerSecond` | `bucketSize` | Notes |
|---|---|---|---|
| Small (<50 servers) | Not needed | — | Disable backpressure |
| Medium (50-500) | 20 | 40 | Default, good for most |
| Large (500-2000) | 30 | 60 | Higher throughput |
| Massive (2000+) | 50 | 100 | Multiple nodes recommended |

---

## Track Serialization (Memory Protection)

### The Problem

Each `Track` object in the queue contains:
- `track` (base64 encoded string, ~200-500 chars)
- `title`, `author`, `uri`, `identifier` (strings)
- `pluginInfo` (object with album URLs, artist URLs, preview URLs — can be 500+ bytes)
- `customData` (user-attached data, unbounded)
- `artworkUrl`, `thumbnail`, `isrc` (strings)

At scale (700 servers × 50-track queues = 35,000 Track objects), the heavy metadata fields waste significant RAM.

### The Solution

`queue.compactQueue()` replaces each Track in the queue with a minimal version that keeps only what's needed for playback:

**Kept:** `track`, `title`, `author`, `duration`, `uri`, `sourceName`, `identifier`, `isSeekable`, `isStream`, `requester`

**Stripped:** `pluginInfo`, `customData`, `artworkUrl`, `thumbnail`, `isrc`

### Usage

```ts
// Compact after adding a large playlist
player.queue.add(playlistTracks);
const compacted = player.queue.compactQueue();
console.log(`Compacted ${compacted} tracks, RAM: ~${(player.queue.memoryEstimate / 1024).toFixed(1)} KB`);

// Check if a track is compacted
import { StellaQueue } from "@stella_project/stellalib";
if (StellaQueue.isCompacted(player.queue[5])) {
  console.log("Track 5 is compacted");
}
```

### When to Compact

| Strategy | When | Trade-off |
|---|---|---|
| **On large playlist add** | After `queue.add(100+ tracks)` | Best RAM savings, immediate |
| **Periodic** | Every 5 minutes via `setInterval` | Catches growth over time |
| **On memory pressure** | When `queue.memoryEstimate > threshold` | Reactive, targeted |
| **Always** | After every `queue.add()` | Most aggressive, no artwork in queue display |

### Impact on UI

Compacted tracks lose `artworkUrl`, `thumbnail`, `isrc`, and `pluginInfo`. If your bot displays artwork in queue embeds, you have two options:

1. **Don't compact** — keep full metadata (fine for small bots)
2. **Compact and re-fetch on display** — compact for memory, decode the track's base64 when you need artwork for the "now playing" embed. The `current` track is never compacted

### Memory Estimation

```ts
const bytes = player.queue.memoryEstimate;
console.log(`Queue memory: ${(bytes / 1024).toFixed(1)} KB`);

// Global memory across all players
let totalBytes = 0;
for (const player of manager.players.values()) {
  totalBytes += player.queue.memoryEstimate;
}
console.log(`Total queue memory: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
```

---

## Voice Hot-Swapping (Silent Re-Identify)

### The Problem

Discord periodically rotates voice servers (close code 4015) or UDP connections desync (close code 4000). When this happens, the Lavalink player's voice connection drops. Without handling, the player goes silent at `0:00` with no errors — the track position stops updating but no exception is thrown.

### How StellaLib Handles It

Instead of cleaning up the player on codes 4000/4015, StellaLib calls `player.reconnectVoice()`:

```
  t=0ms    Discord rotates voice server → code 4015
  t=1ms    socketClosed fires → StellaLib detects recoverable code
  t=5ms    player.reconnectVoice() starts
  t=10ms   Fresh voice state sent to Discord (re-identify)
  t=200ms  Discord responds with new token + endpoint
  t=300ms  Lavalink updated with new voice credentials
  t=500ms  Track resumes at current position
  t=1000ms Audio fully restored (~1s gap)
```

### Close Code Handling

| Code | Meaning | Previous Behavior | New Behavior |
|---|---|---|---|
| **4000** | Unknown error (UDP desync) | Ignored | Auto-reconnect voice |
| **4006** | Session no longer valid | Player cleaned up | Try reconnect, fall back to cleanup |
| **4014** | Disconnected by Discord (kicked) | Player cleaned up | Player cleaned up (unchanged) |
| **4015** | Voice server changed | Ignored | Auto-reconnect voice |

### Events

```ts
manager.on("VoiceReconnect", (player, code) => {
  console.log(`Voice re-identified for ${player.guild} after code ${code}`);
});

manager.on("SocketClosed", (player, payload) => {
  // Still fires for all codes — you can add custom handling here
  console.log(`Socket closed: ${payload.code} — ${payload.reason}`);
});
```

### Manual Trigger

You can also manually trigger a voice reconnect:

```ts
try {
  await player.reconnectVoice();
  console.log("Voice reconnected successfully");
} catch (error) {
  console.log("Voice reconnect failed:", error.message);
}
```

---

## Recommended Production Configuration

For a 700+ server production bot, enable all four features:

```ts
const manager = new StellaManager({
  nodes: [...],
  send: (id, payload) => { ... },
  
  // Session persistence
  sessionStore: new FileSessionStore("./sessions.json"),
  
  // Search caching
  caches: { enabled: true, time: 60000, maxSize: 200 },
  
  // Proactive health monitoring (v1.1.2)
  nodeHealthThresholds: {
    maxCpuLoad: 0.85,
    maxFrameDeficit: 300,
    checkInterval: 30000,
  },
  
  // Zombie detection (v1.3.0) — enabled by default
  zombieDetection: {
    enabled: true,
    checkInterval: 20000,
    maxSilence: 30000,
  },
  
  // REST backpressure (v1.3.0)
  restBackpressure: {
    enabled: true,
    maxRequestsPerSecond: 20,
    bucketSize: 40,
  },
});

// Event handlers for monitoring
manager.on("NodeZombie", (node, count) => {
  logger.warn(`Zombie node: ${node.options.identifier} (${count} players)`);
});

manager.on("VoiceReconnect", (player, code) => {
  logger.info(`Voice hot-swap: ${player.guild} (code ${code})`);
});

manager.on("PlayerFailover", (player, oldNode, newNode) => {
  logger.info(`Failover: ${player.guild} ${oldNode} → ${newNode}`);
});
```

### Memory Protection Strategy

```ts
// Compact queues when they grow large
manager.on("TrackEnd", (player) => {
  if (player.queue.length > 20) {
    player.queue.compactQueue();
  }
});

// Or periodic compaction
setInterval(() => {
  for (const player of manager.players.values()) {
    if (player.queue.length > 10) {
      player.queue.compactQueue();
    }
  }
}, 300000); // Every 5 minutes
```
