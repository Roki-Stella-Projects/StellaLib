# Player State Persistence

StellaLib v1.1.0 introduces **full player state persistence** — not just Lavalink session IDs, but the entire player state including autoplay, queue, filters, repeat modes, and listening history.

## Why?

Before v1.1.0, StellaLib could resume Lavalink sessions (the audio stream kept playing), but client-side state was lost:

| State | Before v1.1.0 | After v1.1.0 |
|---|---|---|
| Audio playback | ✅ Survives (Lavalink session resume) | ✅ Survives |
| Autoplay on/off | ❌ Lost | ✅ Persisted |
| Autoplay history | ❌ Lost (replays recent tracks) | ✅ Persisted (last 50) |
| Autoplay seed pool | ❌ Lost (cold start) | ✅ Persisted (last 5 seeds) |
| Queue (upcoming tracks) | ❌ Lost | ✅ Persisted |
| Filter presets | ❌ Lost | ✅ Persisted |
| Repeat modes | ❌ Lost | ✅ Persisted |
| Volume | ❌ Restored from Lavalink | ✅ Restored from both |

## How It Works

### Shutdown Flow

```
manager.shutdown()
  │
  ├── For each player:
  │     └── player.getFullState() → serialized → store.setPlayerState(guildId, state)
  │
  ├── For each node:
  │     └── node.gracefulClose() → store.set(nodeId, sessionId)
  │
  └── store.flush() → writes to disk
```

### Resume Flow

```
Bot restarts → manager.init() → node.connect()
  │
  ├── Load sessionId from store → send as Session-Id header
  │
  ├── Lavalink sends "ready" op with resumed: true
  │
  ├── node.syncPlayers() → fetches player list from Lavalink
  │     │
  │     └── For each Lavalink player:
  │           ├── Recreate local StellaPlayer if missing
  │           ├── store.getPlayerState(guildId) → player.restoreFromState(state)
  │           │     ├── Restore autoplay on/off + bot user
  │           │     ├── Restore autoplay history + seed pool
  │           │     ├── Restore repeat modes
  │           │     ├── Restore filter config (local state only)
  │           │     └── Restore queue tracks
  │           └── store.deletePlayerState(guildId) → cleanup
  │
  └── Player continues with full state intact
```

## Zero-Config Setup

If you're using `FileSessionStore`, player state persistence is **automatic**:

```ts
import { StellaManager, FileSessionStore } from "@stella_project/stellalib";

const manager = new StellaManager({
  sessionStore: new FileSessionStore("./sessions.json"),
  // That's it — FileSessionStore implements both SessionStore and PlayerStateStore
  // ...
});
```

The JSON file stores both session IDs and player states:

```json
{
  "sessions": {
    "main": "abc123-session-id"
  },
  "players": {
    "123456789012345678": {
      "guildId": "123456789012345678",
      "isAutoplay": true,
      "autoplayHistory": ["https://...", "https://..."],
      "queue": [{ "encoded": "...", "title": "...", "author": "..." }],
      "filters": { "activeFilters": { "bassboost": true } }
    }
  }
}
```

> **Backward compatible:** If you have an old `sessions.json` with the flat `{ nodeId: sessionId }` format, `FileSessionStore` automatically migrates it to the new format on first load.

## Custom Player State Store

For production deployments, you may want to use Redis or a database:

```ts
import type { PlayerStateStore, PlayerPersistData } from "@stella_project/stellalib";

class RedisPlayerStore implements PlayerStateStore {
  constructor(private redis: RedisClient) {}

  async getPlayerState(guildId: string): Promise<PlayerPersistData | null> {
    const raw = await this.redis.get(`player:${guildId}`);
    return raw ? JSON.parse(raw) : null;
  }

  async setPlayerState(guildId: string, state: PlayerPersistData): Promise<void> {
    await this.redis.set(`player:${guildId}`, JSON.stringify(state), "EX", 3600);
  }

  async deletePlayerState(guildId: string): Promise<void> {
    await this.redis.del(`player:${guildId}`);
  }

  async getAllPlayerStates(): Promise<PlayerPersistData[]> {
    const keys = await this.redis.keys("player:*");
    const states: PlayerPersistData[] = [];
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (raw) states.push(JSON.parse(raw));
    }
    return states;
  }
}

const manager = new StellaManager({
  playerStateStore: new RedisPlayerStore(redis),
  // ...
});
```

## Separate vs Combined Stores

You can use different stores for sessions and player states:

```ts
const manager = new StellaManager({
  sessionStore: new FileSessionStore("./sessions.json"),   // Sessions on disk
  playerStateStore: new RedisPlayerStore(redis),           // Player states in Redis
  // ...
});
```

Or use `FileSessionStore` for both (default behavior when only `sessionStore` is set).

## PlayerPersistData Structure

```ts
interface PlayerPersistData {
  guildId: string;
  voiceChannelId: string | null;
  textChannelId: string | null;
  nodeIdentifier: string;
  currentTrack: TrackPersistData | null;
  position: number;
  volume: number;
  paused: boolean;
  trackRepeat: boolean;
  queueRepeat: boolean;
  dynamicRepeat: boolean;
  isAutoplay: boolean;
  botUserId: string | null;
  autoplayHistory: string[];           // Last 50 track URIs/keys
  autoplaySeedPool: SeedEntry[];       // Last 5 seed tracks
  queue: TrackPersistData[];           // All queued tracks
  filters: {
    distortion: object | null;
    equalizer: object[];
    karaoke: object | null;
    rotation: object | null;
    timescale: object | null;
    vibrato: object | null;
    volume: number;
    activeFilters: Record<string, boolean>;  // e.g. { bassboost: true }
  };
}
```

## Debug Logging

Enable the `Debug` event to see persistence in action:

```ts
manager.on("Debug", console.log);
```

Example output:
```
[Manager] Graceful shutdown initiated...
[Manager] Persisted player state for guild 123456 (autoplay: true, queue: 3)
[Manager] Shutdown complete. 1 nodes closed, sessions + player states persisted.
...
[Node:main] Restored persisted state for guild 123456 (autoplay: true)
[Player:123456] Restoring state — autoplay: true, queue: 3 tracks, filters: bassboost
```
