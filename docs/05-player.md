# Player

`StellaPlayer` controls audio playback for a single Discord guild. Each guild gets at most one player.

## Creating a Player

```ts
const player = manager.create({
  guild: "GUILD_ID",           // Discord guild ID (required)
  voiceChannel: "VC_ID",      // Voice channel ID (required)
  textChannel: "TC_ID",       // Text channel ID (optional)
  volume: 50,                 // Initial volume 0-100 (default: 100)
  selfDeafen: true,           // Deafen the bot (default: false)
  selfMute: false,            // Mute the bot (default: false)
});
```

If a player already exists for the guild, the existing player is returned.

## Properties

| Property | Type | Description |
|---|---|---|
| `guild` | `string` | The Discord guild ID |
| `voiceChannel` | `string \| null` | Current voice channel ID |
| `textChannel` | `string \| null` | Text channel for notifications |
| `node` | `StellaNode` | The Lavalink node this player is on |
| `queue` | `StellaQueue` | The track queue |
| `filters` | `StellaFilters` | Audio filter manager |
| `state` | `State` | Connection state |
| `playing` | `boolean` | Whether a track is currently playing |
| `paused` | `boolean` | Whether playback is paused |
| `position` | `number` | Current playback position in ms |
| `volume` | `number` | Current volume (0-100) |
| `trackRepeat` | `boolean` | Whether current track repeats |
| `queueRepeat` | `boolean` | Whether queue repeats |
| `isAutoplay` | `boolean` | Whether autoplay is enabled |
| `voiceReady` | `boolean` | Whether voice connection is established |

## Connection States

```
DISCONNECTED → CONNECTING → CONNECTED
      ↑              ↑            │
      │              │            ▼
  DESTROYING    MOVING       DISCONNECTING
```

| State | Meaning |
|---|---|
| `DISCONNECTED` | Not connected to any voice channel |
| `CONNECTING` | Voice connection in progress |
| `CONNECTED` | Connected and ready for playback |
| `DISCONNECTING` | Disconnecting from voice channel |
| `DESTROYING` | Player is being destroyed |
| `MOVING` | Moving to a different Lavalink node |

## Methods

### Voice

```ts
player.connect();              // Join the voice channel
player.disconnect();           // Leave the voice channel
```

### Playback

```ts
player.play();                 // Play the first track in queue
player.play(track, options);   // Play a specific track with options
player.pause(true);            // Pause playback
player.pause(false);           // Resume playback
player.stop();                 // Stop current track (triggers next in queue)
player.seek(30000);            // Seek to position in ms
player.destroy();              // Leave channel, clear queue, clean up
```

**Play options:**
```ts
player.play(track, {
  startTime: 5000,    // Start at 5 seconds
  endTime: 60000,     // Stop at 60 seconds
  noReplace: false,   // If true, don't replace currently playing track
});
```

### Volume

```ts
player.setVolume(80);          // Set volume (0-100)
```

### Repeat Modes

```ts
player.setTrackRepeat(true);   // Repeat current track forever
player.setTrackRepeat(false);  // Disable track repeat

player.setQueueRepeat(true);   // When queue ends, restart from beginning
player.setQueueRepeat(false);  // Disable queue repeat
```

### Autoplay

```ts
// Enable autoplay — when queue ends, auto-mix engine finds next track
player.setAutoplay(true, client.user);

// Disable autoplay
player.setAutoplay(false, client.user);
```

The second argument (`botUser`) is an object with at least `{ id: string }` — typically your bot's user object.

### Node Migration

```ts
// Move player to a different Lavalink node
player.moveNode("other-node-identifier");
```

This seamlessly transfers the player to another node without interrupting playback.

### Voice Readiness

```ts
// Wait until voice connection is established before sending play commands
await player.waitForVoiceReady();
player.play();
```

This returns a Promise that resolves when the voice connection is fully established. Useful when you need to ensure the connection is ready before issuing play commands.

### State Snapshot

```ts
const snapshot = player.getStateSnapshot();
// {
//   guild: "123456789",
//   voiceChannel: "987654321",
//   textChannel: "111222333",
//   state: "CONNECTED",
//   playing: true,
//   paused: false,
//   position: 45000,
//   volume: 50,
//   trackRepeat: false,
//   queueRepeat: false,
//   isAutoplay: true,
//   currentTrack: { title: "...", author: "...", ... },
//   queueSize: 5,
// }
```

## Usage Example

```ts
// Create player and connect
const player = manager.create({
  guild: guildId,
  voiceChannel: vcId,
  textChannel: tcId,
  volume: 50,
  selfDeafen: true,
});
player.connect();

// Search and add tracks
const result = await manager.search("lofi hip hop", userId);
if (result.tracks.length) {
  player.queue.add(result.tracks[0]);
}

// Start playback
if (!player.playing) player.play();

// Enable autoplay so music never stops
player.setAutoplay(true, client.user);

// Later: skip, adjust volume, add filters
player.stop();                              // Skip to next track
player.setVolume(30);                       // Lower volume
await player.filters.setFilter("nightcore", true); // Add nightcore effect
```
