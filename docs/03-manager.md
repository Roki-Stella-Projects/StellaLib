# Manager

`StellaManager` is the central hub of StellaLib. You create one instance per bot and use it to manage nodes, players, search, and lifecycle.

## Creating a Manager

```ts
import { StellaManager, FileSessionStore } from "@stella_project/stellalib";

const manager = new StellaManager({
  // Required
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
  send(id, payload) {
    const guild = client.guilds.cache.get(id);
    if (guild) guild.shard.send(payload);
  },

  // Optional
  autoPlay: true,
  defaultSearchPlatform: "spotify",
  searchFallback: ["soundcloud", "youtube music", "youtube"],
  sessionStore: new FileSessionStore("./sessions.json"),
  caches: { enabled: true, time: 60000, maxSize: 200 },
  clientName: "MyBot/1.0",
  shards: 1,
});
```

## Initialization

The Manager must be initialized after your Discord client is ready:

```ts
client.on("ready", () => {
  manager.init(client.user!.id);
});
```

`init()` does the following:
1. Sets the `clientId` used in Lavalink headers
2. Connects all configured nodes
3. Marks the manager as initiated

## Properties

| Property | Type | Description |
|---|---|---|
| `nodes` | `Map<string, StellaNode>` | All registered Lavalink nodes |
| `players` | `Map<string, StellaPlayer>` | All active guild players |
| `options` | `ManagerOptions` | The options passed to the constructor |
| `initiated` | `boolean` | Whether `init()` has been called |
| `caches` | `LRUCache` | Search result cache |

## Methods

### `init(clientId: string): this`

Initialize the manager and connect all nodes. Must be called after your Discord client is ready.

### `create(options: PlayerOptions): StellaPlayer`

Create a new player for a guild. If a player already exists for that guild, returns the existing one.

```ts
const player = manager.create({
  guild: "123456789",
  voiceChannel: "987654321",
  textChannel: "111222333",
  volume: 50,
  selfDeafen: true,
  selfMute: false,
});
```

### `get(guildId: string): StellaPlayer | undefined`

Get an existing player for a guild, or `undefined` if none exists.

```ts
const player = manager.get(interaction.guildId);
if (player) {
  player.pause(true);
}
```

### `search(query: string, requester?: string): Promise<SearchResult>`

Search for tracks. Supports direct URLs, platform-prefixed queries, and plain text.

```ts
// Plain text — uses defaultSearchPlatform
const result = await manager.search("never gonna give you up", userId);

// Direct URL
const result = await manager.search("https://open.spotify.com/track/...", userId);

// Platform-prefixed
const result = await manager.search("scsearch:lofi beats", userId);
```

**Return type:**
```ts
interface SearchResult {
  loadType: "track" | "playlist" | "search" | "empty" | "error";
  tracks: Track[];
  playlist?: PlaylistData;
  error?: string;
}
```

**Search fallback:** If the primary platform returns empty/error, the manager automatically tries each platform in `searchFallback` until one succeeds.

### `updateVoiceState(data: VoicePacket | VoiceServer | VoiceStateUpdate): void`

Forward raw Discord gateway events to StellaLib. This is required for voice connections to work.

```ts
client.on("raw", (d) => manager.updateVoiceState(d));
```

The manager filters for `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE` events, assembles the voice connection data, and sends it to Lavalink.

### `shutdown(): Promise<void>`

Gracefully shut down the manager:
1. Persists all session IDs to the session store
2. Gracefully closes all node WebSocket connections
3. Clears caches
4. Flushes the session store

```ts
process.on("SIGINT", async () => {
  await manager.shutdown();
  process.exit(0);
});
```

### `getStats(): object`

Get statistics about the manager's state:

```ts
const stats = manager.getStats();
// {
//   nodes: number,
//   players: number,
//   playingPlayers: number,
//   cacheSize: number,
//   cacheMemoryEstimate: number,
// }
```

### `destroyNode(identifier: string): void`

Remove and disconnect a node by its identifier.

### `getAvailableSources(node?: StellaNode): Promise<string[]>`

Get the list of available source managers from a Lavalink node.

### `decodeTracks(tracks: string[], node?: StellaNode): Promise<TrackData[]>`

Decode an array of base64 track strings into full track data objects.

## Node Selection

When creating a player, the Manager selects the best available node using a penalty scoring system:

```
penalty = cpuPenalty + deficitFramePenalty + nullFramePenalty + playerPenalty
```

- **CPU penalty** — Higher Lavalink CPU load = higher penalty
- **Frame deficit** — Missing audio frames increase penalty
- **Null frames** — Null frames indicate problems
- **Player count** — More players = slightly higher penalty

The node with the **lowest penalty** is selected.

## Caching

When `caches.enabled` is true, search results are cached in an LRU cache:

- **TTL** — Entries expire after `caches.time` milliseconds
- **Max size** — Cache holds at most `caches.maxSize` entries
- **Pruning** — Expired entries are pruned periodically
- **Key** — Based on the search identifier string

Cache is automatically cleared on shutdown.
