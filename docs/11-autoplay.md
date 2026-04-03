# Autoplay Engine

StellaLib's smart autoplay engine automatically finds and plays the next track when the queue ends, creating a seamless listening experience.

## Enabling Autoplay

```ts
// Enable autoplay for a player
player.setAutoplay(true, client.user);

// Disable autoplay
player.setAutoplay(false, client.user);
```

The second argument is the bot's user object (must have at least `{ id: string }`).

You also need `autoPlay: true` on the Manager for the engine to trigger:

```ts
const manager = new StellaManager({
  autoPlay: true,
  // ...
});
```

## How It Works

When a track ends and the queue is empty, the autoplay engine runs through these steps:

```
Queue empty + autoplay enabled
        │
        ▼
┌─────────────────────┐
│ 1. Collect Seeds     │ ← Last 5 played tracks
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 2. Detect Source     │ ← Spotify? YouTube? SoundCloud?
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 3. Get Candidates    │ ← Spotify recs, YouTube Mix, or search
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 4. Score & Filter    │ ← Duration, author overlap, history check
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 5. Play Best Match   │ ← Highest scoring candidate
└──────────┬──────────┘
           ▼
   If failed → Fallback chain
```

## Step by Step

### 1. Seed Collection

The engine gathers the last 5 played tracks as "seeds". These provide context about what the listener is enjoying.

```
Recent history: [Track A, Track B, Track C, Track D, Track E]
                 ↑ oldest                         newest ↑
```

### 2. Source Detection

Determines the primary source platform by checking the most recent tracks' `sourceName`:
- If most recent tracks are from **Spotify** → use Spotify recommendations
- If from **YouTube** → use YouTube Mix
- Otherwise → fall back to search-based recommendations

### 3. Candidate Fetching

**Strategy A: Spotify Recommendations (`sprec:`)**

If seeds are Spotify tracks, the engine builds a recommendation query:
```
sprec:seed_artists=artist1,artist2&seed_tracks=trackId1,trackId2
```

This uses Lavalink's Spotify plugin to fetch personalized recommendations based on the seed artists and tracks.

**Strategy B: YouTube Mix**

For YouTube sources, the engine requests the YouTube Mix for the most recent track, which YouTube generates as a related playlist.

**Strategy C: Search-based**

If neither Spotify nor YouTube recs are available:
1. Extract theme keywords from recent track titles/authors
2. Search for those keywords on available platforms
3. Use results as candidates

### 4. Candidate Scoring

Each candidate track is scored on multiple criteria:

| Criterion | Weight | Description |
|---|---|---|
| **Duration similarity** | High | Prefer tracks close in length to recent plays. A 3-minute song shouldn't be followed by a 30-minute mix. |
| **Author overlap** | Medium | Bonus if the artist matches or overlaps with recent artists. Keeps the vibe consistent. |
| **Title keyword overlap** | Medium | Bonus if the title shares keywords with recent tracks. |
| **Remix/cover penalty** | Negative | Penalizes tracks with "remix", "cover", "live" in the title to prefer originals. |
| **History check** | Critical | Tracks in the last 50 played are **completely excluded**. No repeats. |
| **Source consistency** | Low | Small bonus for staying on the same platform. |

### 5. Best Transition

The highest-scoring candidate is selected. If the candidate is from a non-streamable source (e.g., Spotify metadata), the engine mirrors it:

1. Searches for the same track on SoundCloud or YouTube
2. Uses the mirror version for actual playback
3. Falls back to the original if no mirror found

### Fallback Chain

If the primary strategy fails, the engine tries alternatives:

```
1. Spotify recommendations → failed
2. YouTube Mix → failed
3. Theme keyword search → failed
4. Same artist search → failed
5. Give up → emit QueueEnd
```

## History Tracking

The engine maintains a rolling history of the last **50 played tracks** per player. This ensures:

- No track is repeated within the last 50 plays
- The listening experience stays fresh
- History is checked by comparing track identifiers and titles

## Transition Quality

The scoring system ensures smooth transitions:

```
Currently playing: "Yoasobi - Racing into the Night" (3:32, J-pop)

Candidate A: "Yoasobi - Idol" (3:27, J-pop)
  → Duration: 97% similar ✓
  → Author: exact match ✓✓
  → Score: 0.92

Candidate B: "Random DJ - Racing into the Night Remix" (6:45, EDM)
  → Duration: 52% similar ✗
  → Author: no match ✗
  → Remix penalty ✗
  → Score: 0.31

Candidate C: "Ado - Show" (3:15, J-pop)
  → Duration: 92% similar ✓
  → Author: no match, but genre overlap
  → Score: 0.65

Winner: Candidate A
```

## Configuration Tips

- **Enable on the Manager:** Set `autoPlay: true` in Manager options
- **Enable per Player:** Call `player.setAutoplay(true, botUser)` for each player
- **Spotify source manager:** For best results, use a Lavalink server with the Spotify plugin installed. This enables `sprec:` seed-based recommendations.
- **Multiple sources:** Having multiple source managers (Spotify + YouTube + SoundCloud) gives the engine more fallback options

## Debug Logging

Enable debug events to see autoplay decisions:

```ts
manager.on("Debug", (message) => {
  if (message.includes("[AutoMix]")) {
    console.log(message);
  }
});
```

Example output:
```
[AutoMix] Playing (spotify-rec): "Idol" by "Yoasobi"
[AutoMix] No suitable transition found, stopping.
[AutoMix] Playing (yt-mix): "Show" by "Ado"
```
