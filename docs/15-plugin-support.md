# Plugin Support

StellaLib v1.2.0 introduces built-in support for several Lavalink plugins and advanced playback features. These are opt-in — they require the corresponding Lavalink plugin to be installed on your server.

---

## SponsorBlock

Auto-skip sponsor segments, intros, outros, and other non-music content in YouTube videos. Requires the [SponsorBlock plugin](https://github.com/topi314/Sponsorblock-Plugin) on your Lavalink server.

### Setup

Install the plugin on your Lavalink server (see the plugin's README), then use the StellaLib API:

```ts
// Enable SponsorBlock for a player with specific categories
await player.setSponsorBlock(["sponsor", "selfpromo", "intro", "outro"]);

// Get currently configured segments
const segments = await player.getSponsorBlock();

// Disable SponsorBlock
await player.clearSponsorBlock();
```

### Available Categories

| Category | Description |
|---|---|
| `sponsor` | Paid promotion or sponsorship |
| `selfpromo` | Self-promotion (subscribe, merch, etc.) |
| `intro` | Intro animation or bumper |
| `outro` | Outro / end cards |
| `preview` | Preview of upcoming content |
| `music_offtopic` | Non-music section in a music video |
| `interaction` | Reminder to like/subscribe |
| `filler` | Tangent or filler content |

### Event

```ts
manager.on("SegmentSkipped", (player, segment) => {
  console.log(`Skipped ${segment.category} (${segment.start}ms - ${segment.end}ms)`);
  // Optionally notify the text channel
});
```

---

## LavaSearch

Structured search that returns tracks, albums, artists, playlists, and text suggestions. Requires the [LavaSearch plugin](https://github.com/topi314/LavaSearch) on your Lavalink server.

### Usage

```ts
const results = await manager.lavaSearch({
  query: "natori",
  types: ["track", "album", "artist", "playlist", "text"],
  source: "spsearch", // Spotify search
});

// Results contain structured data
console.log(results.tracks);     // Track[]
console.log(results.albums);     // { name, url, tracks }[]
console.log(results.artists);    // { name, url }[]
console.log(results.playlists);  // { name, url }[]
console.log(results.texts);      // { text }[] — autocomplete suggestions
```

### Search Sources

| Source | Prefix | Description |
|---|---|---|
| Spotify | `spsearch` | Spotify catalog |
| YouTube Music | `ytsearch` | YouTube Music |
| SoundCloud | `scsearch` | SoundCloud |
| Deezer | `dzsearch` | Deezer catalog |

---

## RoutePlanner API

IP rotation management for nodes that use multiple outgoing IPs to avoid YouTube/Discord rate limits. Works with Lavalink's built-in RoutePlanner.

### Usage

```ts
// Get current route planner status
const status = await manager.getRoutePlannerStatus();
console.log(status.class);   // e.g., "RotatingNanoIpRoutePlanner"
console.log(status.details); // IP block info, failing addresses, etc.

// Free a specific IP address (unmark it as failing)
await manager.freeRoutePlannerAddress("1.2.3.4");

// Free all failing addresses
await manager.freeAllRoutePlannerAddresses();
```

---

## Crossfade

Smooth volume fade-out transitions between tracks. When the current track is about to end, the volume gradually decreases while the next track starts:

```ts
// Enable crossfade with 3-second fade
player.setCrossfade(3000);

// Disable crossfade
player.setCrossfade(0);
```

### How It Works

1. A position monitor watches the current track's progress
2. When `position >= duration - crossfadeMs`, the fade-out starts
3. Volume gradually decreases to 0 over the crossfade duration
4. The next track starts playing (volume auto-restores on `TrackStart`)

### Event

```ts
manager.on("CrossfadeStart", (player, currentTrack, nextTrack) => {
  console.log(`Crossfading: ${currentTrack.title} → ${nextTrack.title}`);
});
```

---

## Auto-Ducking

Temporarily reduce music volume during TTS announcements, bot voice messages, or any other audio event:

```ts
// Duck to volume 10 (from whatever the current volume is)
player.duck(10);

// ... play your TTS or announcement ...

// Restore original volume
player.unduck();

// Check if currently ducked
if (player.isDucked) {
  console.log("Music is currently ducked");
}
```

### Use Cases

- **TTS announcements** — duck music while a track announcement plays
- **Voice commands** — reduce volume during voice recognition
- **Game events** — lower music during important in-game audio

---

## Opus Priority

Discord's voice protocol uses Opus natively. When Lavalink serves audio from non-Opus sources, it must transcode to Opus, using extra CPU. Opus Priority reorders search results so Opus-native sources appear first:

```ts
const manager = new StellaManager({
  opusPriority: true,
  // ...
});
```

### Opus-Native Sources

These sources serve Opus directly — zero transcoding:
- **SoundCloud** — native Opus
- **YouTube Music** — native Opus (via YouTube)
- **YouTube** — native Opus

### Non-Opus Sources

These require transcoding (more Lavalink CPU):
- **Spotify** — requires decode from OGG Vorbis
- **Deezer** — requires decode from MP3/FLAC
- **Tidal** — requires decode from FLAC

### Impact

At scale (500+ concurrent players), transcoding CPU can be significant. Opus Priority reduces this by preferring native sources when available, without changing the user experience.

---

## Buffer Duration

Control the audio stream buffer size for a player:

```ts
// Set buffer to 5 seconds
await player.setBufferDuration(5000);
```

Larger buffers reduce the chance of audio stuttering on unstable networks but increase latency. The default is typically sufficient for most use cases.
