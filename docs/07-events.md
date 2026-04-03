# Events

StellaLib uses a fully typed event emitter. All events are emitted on the `StellaManager` instance.

## Listening to Events

```ts
manager.on("EventName", (arg1, arg2, ...) => {
  // Handle event
});
```

## Node Events

### `NodeCreate`

Fired when a node instance is created (before connection).

```ts
manager.on("NodeCreate", (node: StellaNode) => {
  console.log(`Node created: ${node.options.identifier}`);
});
```

### `NodeConnect`

Fired when a node's WebSocket connection is established.

```ts
manager.on("NodeConnect", (node: StellaNode) => {
  console.log(`Connected to ${node.options.identifier} (Lavalink v${node.version})`);
});
```

### `NodeReconnect`

Fired when a node begins a reconnection attempt.

```ts
manager.on("NodeReconnect", (node: StellaNode) => {
  console.log(`Reconnecting to ${node.options.identifier}...`);
});
```

### `NodeDisconnect`

Fired when a node's WebSocket disconnects.

```ts
manager.on("NodeDisconnect", (node: StellaNode, reason: { code: number; reason: string }) => {
  console.log(`Disconnected from ${node.options.identifier}: ${reason.code} - ${reason.reason}`);
});
```

### `NodeDestroy`

Fired when a node is permanently destroyed (removed from the manager).

```ts
manager.on("NodeDestroy", (node: StellaNode) => {
  console.log(`Node destroyed: ${node.options.identifier}`);
});
```

### `NodeError`

Fired when an error occurs on a node.

```ts
manager.on("NodeError", (node: StellaNode, error: Error) => {
  console.error(`Error on ${node.options.identifier}:`, error.message);
});
```

### `NodeRaw`

Fired for every raw WebSocket message received from Lavalink. Useful for debugging.

```ts
manager.on("NodeRaw", (payload: any) => {
  console.log("Raw payload:", payload.op);
});
```

## Track Events

### `TrackStart`

Fired when a track starts playing.

```ts
manager.on("TrackStart", (player: StellaPlayer, track: Track, payload: TrackStartEvent) => {
  console.log(`Now playing: ${track.title} by ${track.author}`);
  console.log(`In guild: ${player.guild}`);
  console.log(`On node: ${player.node.options.identifier}`);
});
```

### `TrackEnd`

Fired when a track finishes playing. Check `payload.reason` for why it ended.

```ts
manager.on("TrackEnd", (player: StellaPlayer, track: Track, payload: TrackEndEvent) => {
  console.log(`Track ended: ${track.title} (reason: ${payload.reason})`);
});
```

**End reasons:**
| Reason | Meaning |
|---|---|
| `finished` | Track played to completion |
| `loadFailed` | Track failed to load/decode |
| `stopped` | Track was manually stopped |
| `replaced` | Track was replaced by another |
| `cleanup` | Node cleanup (disconnect, etc.) |

### `TrackStuck`

Fired when a track gets stuck (Lavalink can't stream audio).

```ts
manager.on("TrackStuck", (player: StellaPlayer, track: Track, payload: TrackStuckEvent) => {
  console.warn(`Track stuck: ${track.title} (threshold: ${payload.thresholdMs}ms)`);
  // StellaLib automatically stops the stuck track
});
```

### `TrackError`

Fired when a track encounters a playback exception.

```ts
manager.on("TrackError", (player: StellaPlayer, track: Track, payload: TrackExceptionEvent) => {
  console.error(`Track error: ${track.title}`, payload.exception);
  // StellaLib automatically stops the errored track
});
```

### `QueueEnd`

Fired when the queue is empty and no more tracks to play (and autoplay didn't find a track).

```ts
manager.on("QueueEnd", (player: StellaPlayer, track: Track, payload: TrackEndEvent) => {
  console.log(`Queue ended in ${player.guild}`);

  // Common pattern: destroy player after a timeout
  setTimeout(() => {
    const p = manager.players.get(player.guild!);
    if (p && !p.queue.current) {
      p.destroy();
    }
  }, 30000); // 30 second idle timeout
});
```

## Player Events

### `PlayerCreate`

Fired when a new player is created via `manager.create()`.

```ts
manager.on("PlayerCreate", (player: StellaPlayer) => {
  console.log(`Player created for guild ${player.guild}`);
});
```

### `PlayerDestroy`

Fired when a player is destroyed via `player.destroy()`.

```ts
manager.on("PlayerDestroy", (player: StellaPlayer) => {
  console.log(`Player destroyed for guild ${player.guild}`);
});
```

### `PlayerMove`

Fired when the bot is moved to a different voice channel (by a user or server action).

```ts
manager.on("PlayerMove", (player: StellaPlayer, oldChannel: string, newChannel: string) => {
  console.log(`Moved from ${oldChannel} to ${newChannel} in ${player.guild}`);
});
```

### `PlayerDisconnect`

Fired when the bot is disconnected from a voice channel.

```ts
manager.on("PlayerDisconnect", (player: StellaPlayer, oldChannel: string) => {
  console.log(`Disconnected from ${oldChannel} in ${player.guild}`);
});
```

### `PlayerStateUpdate`

Fired when the player's state changes (position update, playing/paused state change).

```ts
manager.on("PlayerStateUpdate", (oldPlayer: StellaPlayer, newPlayer: StellaPlayer) => {
  console.log(`State updated for ${newPlayer.guild}`);
});
```

### `SocketClosed`

Fired when Lavalink's WebSocket connection for a specific player is closed.

```ts
manager.on("SocketClosed", (player: StellaPlayer, payload: WebSocketClosedEvent) => {
  console.log(`Socket closed for ${player.guild}: ${payload.code} - ${payload.reason}`);
});
```

## Debug Event

### `Debug`

Fired for internal debug messages. Useful for troubleshooting.

```ts
manager.on("Debug", (message: string) => {
  console.debug(`[StellaLib] ${message}`);
});
```

Example debug messages:
```
[Manager] Initialized
[Node:main] Connecting to ws://localhost:2333/v4/websocket
[Node:main] Connected
[Search] Found results via fallback "soundcloud" for "query"
[Player:123456789] Voice state flushed to Lavalink
[AutoMix] Playing (spotify-rec): "Song Title" by "Artist"
[Cache] Pruned 5 expired entries (195 remaining)
[Manager] Graceful shutdown initiated...
```

## Event Summary Table

| Event | Parameters | When |
|---|---|---|
| `NodeCreate` | `(node)` | Node instance created |
| `NodeConnect` | `(node)` | WebSocket connected |
| `NodeReconnect` | `(node)` | Reconnection attempt started |
| `NodeDisconnect` | `(node, reason)` | WebSocket disconnected |
| `NodeDestroy` | `(node)` | Node permanently removed |
| `NodeError` | `(node, error)` | Error on node |
| `NodeRaw` | `(payload)` | Raw WS message received |
| `TrackStart` | `(player, track, payload)` | Track started playing |
| `TrackEnd` | `(player, track, payload)` | Track finished |
| `TrackStuck` | `(player, track, payload)` | Track stuck |
| `TrackError` | `(player, track, payload)` | Track exception |
| `QueueEnd` | `(player, track, payload)` | Queue empty, nothing to play |
| `PlayerCreate` | `(player)` | Player created |
| `PlayerDestroy` | `(player)` | Player destroyed |
| `PlayerMove` | `(player, oldCh, newCh)` | Bot moved channels |
| `PlayerDisconnect` | `(player, oldCh)` | Bot disconnected from voice |
| `PlayerStateUpdate` | `(oldPlayer, newPlayer)` | Player state changed |
| `SocketClosed` | `(player, payload)` | Lavalink WS closed for player |
| `Debug` | `(message)` | Internal debug log |
