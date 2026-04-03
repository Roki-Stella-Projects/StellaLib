# Seamless Node Failover

StellaLib implements a multi-layer failover system that keeps music playing even when Lavalink nodes crash, disconnect, or become overloaded. The goal is **zero-interruption audio** — listeners should never notice a node switch.

## How It Works

```
                          Normal Operation
                    ┌──────────────────────────┐
                    │   Node A (primary)        │
                    │   ├─ Player guild_1 ♪     │
                    │   ├─ Player guild_2 ♪     │
                    │   └─ Player guild_3 ♪     │
                    └──────────────────────────┘

                        Node A crashes! 💥

                    ┌──────────────────────────┐
  Seamless          │   Node B (backup)         │    Audio continues
  Failover ──────►  │   ├─ Player guild_1 ♪     │◄── at exact same
  (<2 sec)          │   ├─ Player guild_2 ♪     │    position
                    │   └─ Player guild_3 ♪     │
                    └──────────────────────────┘
```

## Three Layers of Protection

### Layer 1: Seamless Failover (Immediate)

When a node unexpectedly disconnects mid-playback, StellaLib **immediately** moves all playing/paused players to a healthy node:

1. WebSocket `close` event fires on the dead node
2. `attemptSeamlessFailover()` collects all active players on that node
3. Healthy nodes are sorted by **penalty score** (CPU load + frame deficit + player count)
4. Players are distributed across healthy nodes using smart load balancing
5. Each player's `moveNode()` sends voice state + track + position to the new node
6. The `PlayerFailover` event is emitted for each moved player

**This happens before the reconnect cycle even starts** — players don't wait for the dead node to recover.

```ts
// Listen for failover events in your bot
manager.on("PlayerFailover", (player, oldNode, newNode) => {
  console.log(`[Failover] Player ${player.guild} moved: ${oldNode} → ${newNode}`);
  // Optionally notify the guild
  const channel = client.channels.cache.get(player.textChannel);
  channel?.send("🔄 Audio server switched — playback continues!");
});
```

### Layer 2: Proactive Health Monitoring

Before nodes crash, StellaLib can detect degradation and migrate players **preemptively**:

```ts
const manager = new StellaManager({
  nodeHealthThresholds: {
    maxCpuLoad: 0.85,       // Migrate when CPU > 85%
    maxFrameDeficit: 300,   // Migrate when frames are dropping
    checkInterval: 30000,   // Check every 30 seconds
  },
});
```

This is the **proactive** layer — it moves players before they experience audio glitches.

### Layer 3: Node Destroy Failover

When a node is explicitly destroyed (e.g., removed from the pool), all its players are moved to healthy nodes:

```ts
manager.destroyNode("laggy-node"); // Players auto-move to other nodes
```

## moveNode() — The Core Mechanism

Every failover ultimately calls `player.moveNode()`, which performs these steps:

```
1. Fetch accurate track position from source node (if still alive)
   └─ Falls back to local position if source is dead

2. Send voice connection to destination node
   └─ token + endpoint + sessionId + channelId

3. Send track + position + volume + filters to destination
   └─ encodedTrack + position(ms) + volume + paused + all filters

4. Update player's node reference

5. Destroy player on old node (best-effort, may be dead)

6. Emit Debug log with move details
```

**Key design decisions:**
- Voice state is sent **first** so Lavalink joins the voice channel before receiving the track
- Position is preserved to the millisecond for seamless audio continuation
- All filters (EQ, timescale, karaoke, etc.) are transferred to maintain audio quality
- If the source node is already dead, the local position is used (accurate within ~1 second)

## Penalty-Based Node Selection

When choosing which node to move a player to, StellaLib uses a penalty scoring system:

```
penalty = CPU_penalty + frame_deficit_penalty + null_frame_penalty + player_count

Where:
  CPU_penalty      = f(systemLoad, lavalinkLoad, cores)
  frame_deficit    = f(deficit / 3000)  — frames lost per 3000
  null_frames      = f(nulled / 3000)   — silent frames per 3000
  player_count     = number of playing players
```

Lower penalty = better node. During failover, players are distributed across nodes to balance load.

## Event Reference

| Event | Parameters | When |
|---|---|---|
| `PlayerFailover` | `(player, oldNodeId, newNodeId)` | Player successfully moved to a new node |
| `NodeDisconnect` | `(node, { code, reason })` | Node WebSocket disconnected |
| `Debug` | `(message)` | Detailed failover logs (prefix: `[Failover]`) |

## Configuration

No special configuration is needed for basic failover — it works automatically when you have 2+ nodes:

```ts
const manager = new StellaManager({
  nodes: [
    { host: "lava1.example.com", port: 2333, password: "secret", identifier: "node-1" },
    { host: "lava2.example.com", port: 2333, password: "secret", identifier: "node-2" },
    { host: "lava3.example.com", port: 2333, password: "secret", identifier: "node-3" },
  ],
  // Optional: proactive health monitoring
  nodeHealthThresholds: {
    maxCpuLoad: 0.85,
    maxFrameDeficit: 300,
    checkInterval: 30000,
  },
  send: (id, payload) => { /* ... */ },
});
```

## Best Practices

1. **Always run 2+ Lavalink nodes** in production for redundancy
2. **Use different servers/regions** for your nodes to survive datacenter outages
3. **Enable health monitoring** (`nodeHealthThresholds`) for proactive migration
4. **Listen to `PlayerFailover`** events to optionally notify users
5. **Monitor `Debug` events** with the `[Failover]` prefix for operational visibility
6. **Set `resumeStatus: true`** on nodes so sessions survive brief disconnects

## Failover Timeline

```
t=0ms    Node A WebSocket closes unexpectedly
t=1ms    close() handler fires
t=2ms    attemptSeamlessFailover() starts
t=3ms    Affected players identified, healthy nodes sorted
t=5ms    First moveNode() call begins
t=50ms   Voice state sent to Node B
t=100ms  Track + position sent to Node B
t=150ms  Audio resumes on Node B ♪
         ────────────────────────────
         Total gap: ~150ms (imperceptible)

Meanwhile:
t=2000ms Node A reconnect attempt #1 starts
t=5000ms Node A reconnects (if server recovered)
         (Players are already safe on Node B)
```

## Failure Modes

| Scenario | Behavior |
|---|---|
| 1 of 3 nodes dies | Players move to remaining 2 nodes |
| 2 of 3 nodes die | All players concentrate on last node |
| All nodes die | Players wait for first node to reconnect |
| Node dies, comes back in <60s | Session resumes, no player rebuild needed |
| Node overloaded (CPU > threshold) | Health monitor migrates players before crash |
| Fatal close code (4001, 4004) | Players rescued, node not reconnected |
