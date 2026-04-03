# Queue

`StellaQueue` extends JavaScript's `Array<Track | UnresolvedTrack>` with music-specific methods for managing the playback queue.

## Properties

| Property | Type | Description |
|---|---|---|
| `current` | `Track \| null` | The currently playing track (not part of the array) |
| `previous` | `Track \| null` | The previously played track |
| `size` | `number` | Number of queued tracks (excluding current) |
| `totalSize` | `number` | `current` (1 if exists) + queued track count |
| `duration` | `number` | Total duration of all queued tracks in ms |

## Methods

### `add(track: Track | Track[], offset?: number): void`

Add one or more tracks to the queue.

```ts
// Add a single track to the end
player.queue.add(track);

// Add multiple tracks
player.queue.add([track1, track2, track3]);

// Add at a specific position (0-indexed)
player.queue.add(track, 0); // Add to front of queue
player.queue.add(track, 3); // Add at position 3
```

### `remove(position: number): Track[]`

Remove a track at a specific index. Returns an array of removed tracks.

```ts
// Remove the first queued track
const removed = player.queue.remove(0);
console.log(`Removed: ${removed[0].title}`);
```

### `remove(start: number, end: number): Track[]`

Remove a range of tracks (inclusive start, exclusive end).

```ts
// Remove tracks at index 0, 1, 2
const removed = player.queue.remove(0, 3);
console.log(`Removed ${removed.length} tracks`);
```

### `clear(): void`

Remove all tracks from the queue (does not affect the currently playing track).

```ts
player.queue.clear();
console.log(player.queue.size); // 0
console.log(player.queue.current); // Still playing
```

### `shuffle(): void`

Randomize the order of queued tracks using the Fisher-Yates algorithm.

```ts
player.queue.shuffle();
```

## Track Interface

Each track in the queue has these properties:

```ts
interface Track {
  readonly track: string;      // Base64 encoded track data
  artworkUrl: string | null;   // Album art URL
  sourceName: string;          // Source (youtube, spotify, etc.)
  title: string;               // Track title
  identifier: string;          // Source-specific track ID
  author: string;              // Artist name
  duration: number;            // Duration in ms
  isSeekable: boolean;         // Whether seeking is supported
  isStream: boolean;           // Whether it's a live stream
  uri: string | null;          // Track URL
  thumbnail: string | null;    // Thumbnail URL
  requester: unknown;          // Who requested this track
  displayThumbnail(size?): string; // Get thumbnail URL at specific size
  customData: Record<string, unknown>; // Custom metadata
}
```

## Repeat Modes

The queue interacts with the Player's repeat settings:

| Mode | Behavior |
|---|---|
| No repeat | Track plays → removed from queue → next track plays |
| Track repeat | Track plays → plays again → plays again → ... |
| Queue repeat | Track plays → moves to end of queue → next plays → ... cycles forever |

```ts
player.setTrackRepeat(true);  // Current track loops
player.setQueueRepeat(true);  // Entire queue loops
```

## Usage Example

```ts
// Search and add tracks
const result = await manager.search("lofi playlist", userId);
if (result.loadType === "playlist" && result.playlist) {
  player.queue.add(result.playlist.tracks);
  console.log(`Added ${result.playlist.tracks.length} tracks`);
}

// Check queue state
console.log(`Queue: ${player.queue.size} tracks`);
console.log(`Now playing: ${player.queue.current?.title}`);
console.log(`Total duration: ${player.queue.duration}ms`);

// Manipulate queue
player.queue.shuffle();        // Shuffle
player.queue.remove(0);        // Remove next up
player.queue.clear();          // Clear everything

// Queue with repeat
player.setQueueRepeat(true);   // Loop the whole queue
```
