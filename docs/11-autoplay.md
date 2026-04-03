# Autoplay Engine

StellaLib's smart autoplay engine automatically finds and plays the next track when the queue ends, creating a seamless listening experience that stays on-style.

## Enabling Autoplay

```ts
// Enable autoplay for a player
player.setAutoplay(true, client.user);

// Disable autoplay (also resets anchor, seed pool, and history)
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
┌──────────────────────────┐
│ 1. Anchor + Seed Update   │ ← Set anchor (first time), push to seed pool (last 5)
└───────────┬──────────────┘
            ▼
┌──────────────────────────┐
│ 2. Detect Source          │ ← Spotify? YouTube? SoundCloud?
└───────────┬──────────────┘
            ▼
┌──────────────────────────┐
│ 3. Get Candidates         │ ← Spotify recs, YouTube Mix, or smart search
└───────────┬──────────────┘
            ▼
┌──────────────────────────┐
│ 4. Score & Filter         │ ← Duration, author, anchor, seed-pool, history
└───────────┬──────────────┘
            ▼
┌──────────────────────────┐
│ 5. Play Best Match        │ ← Highest scoring candidate (random from top 3)
└───────────┬──────────────┘
            ▼
   If failed → Fallback chain
```

## Step by Step

### 1. Anchor + Seed Collection

The engine maintains two layers of style context:

**Anchor (permanent):** The very first track that started the current autoplay session. Set once, never overwritten. Used to prevent long-term style drift — even after 20+ songs, the engine can still measure how far a candidate is from what the user originally chose.

**Seed pool (rolling):** The last 5 played tracks. Provides short-term context for transitions.

```
Anchor: [Track A] ← original pick, style reference forever

Seed pool (slides forward):
  Round 1: [A]
  Round 2: [A, B]
  Round 3: [A, B, C]
  Round 4: [A, B, C, D]
  Round 5: [A, B, C, D, E]
  Round 6: [B, C, D, E, F]  ← A leaves pool but anchor still tracks it
```

Calling `player.setAutoplay(false, botUser)` clears both the anchor and seed pool, so enabling autoplay again starts a clean session.

### 2. Source Detection

Determines the primary source platform by checking the most recent tracks' `sourceName`:
- If most recent seeds are from **Spotify** → use Spotify recommendations
- If from **YouTube** → use YouTube Mix
- Otherwise → fall back to search-based recommendations

### 3. Candidate Fetching

**Strategy A: Spotify Recommendations (`sprec:`)**

If seeds are Spotify tracks, the engine builds a multi-seed recommendation query:
```
sprec:seed_artists=artistId&seed_tracks=trackId1,trackId2,trackId3
```

This uses Lavalink's Spotify plugin for personalized recommendations based on the seed artists and up to 3 seed tracks.

**Strategy B: Author-based search (Smart)**

For non-Spotify sources, the engine builds targeted search queries:

1. **Author + title keywords first** — Always the first query. Extracts meaningful words from the track title (strips noise words like `feat`, `remix`, `official`, `version`) and combines with the artist name. Example: `sea.` + `สมดุลรัก Balance` → `scsearch:sea. สมดุลรัก Balance`
2. **Bare author name** — Only used if the artist name is **longer than 5 meaningful characters** after stripping punctuation. Short/generic names like `sea.`, `Ado`, `IU`, `G.E.M.` skip this step to avoid generic search pollution
3. **Cross-artist from seed pool** — If multiple artists are in the seed pool, tries an alternate artist with the same title-context guard
4. **YouTube fallback** — Author + title keywords on YouTube

**Strategy C: Theme keyword search**

Falls back to extracting the most common keywords across all recent seed titles for a theme-based search.

**Strategy D: YouTube Radio Mix**

If the previous track was a YouTube video, requests its YouTube Mix playlist for related content.

### 4. Candidate Scoring

Each candidate track is scored on multiple criteria:

| Criterion | Max Points | Description |
|---|---|---|
| **Duration similarity** | +40 | ±30s = 40pts, ±60s = 25pts, ±120s = 10pts |
| **Author match (previous)** | +30 | Exact match = 30, word overlap = up to 20 |
| **Title keyword overlap (previous)** | +24 | Shared meaningful words with the previous track |
| **Anchor author match** | +25 | Similarity to the original session-starting track's artist |
| **Anchor title overlap** | +18 | Shared keywords with the anchor track's title |
| **Seed-pool author affinity** | +16 | Bonus per seed that shares the candidate's artist |
| **Diversity bonus** | +15 | Fresh artist not seen in last 3 seeds |
| **Duration sanity** | +10 | Track between 1min and 8min |
| **Source match (previous)** | +5 | Same platform as previous track |
| **Anchor source match** | +5 | Same platform as the anchor track |
| **Stream penalty** | -30 | Live streams excluded (unknown duration) |
| **Repetition penalty** | -20 | Same artist in 2+ of last 3 seeds |
| **History exclusion** | hard | Tracks in last 50 played are **completely excluded** |

The top 3 scoring candidates are eligible, with a small random pick among them for variety.

### 5. Best Transition

The highest-scoring candidate is selected. If the candidate is from a non-streamable source (e.g., Spotify metadata), the engine mirrors it:

1. Searches for the same track on SoundCloud
2. Falls back to YouTube if SoundCloud has no match
3. Uses the mirror for actual playback

### Fallback Chain

```
1. Spotify recommendations  → no result?
2. Author + title search    → no result?
3. Bare author search       → skipped if name too short
4. Cross-artist seed search → no result?
5. YouTube author search    → no result?
6. Theme keyword search     → no result?
7. YouTube Mix (yt source)  → no result?
8. Give up → emit QueueEnd
```

## Style Drift Prevention

Before v1.1.3, the engine could "snowball" into a completely different genre within a few songs:

```
User plays: "sea. - สมดุลรัก (Balance)" [Thai pop]
  ↓ searches scsearch:sea. → returns anything with "sea" in it
  ↓ picks "M83 - My Tears Are Becoming a Sea (Summit Schranz Edit)"
  ↓ searches scsearch:Summit → returns all Summit Schranz edits
  ↓ picks "Santigold - Disparate Youth (Summit Schranz Edit)"
  → 3 songs in, completely off-genre ✗
```

After v1.1.3:

```
User plays: "sea. - สมดุลรัก (Balance)" [Thai pop]
  ↓ anchor = { author: "sea.", title: "สมดุลรัก (Balance)", ... }
  ↓ searches scsearch:sea. สมดุลรัก Balance → actual SEA. tracks
  ↓ candidate scoring penalizes anything not similar to anchor
  ↓ picks a track by same/similar Thai artist
  → style stays on-track ✓
```

## History Tracking

The engine maintains a rolling history of the last **50 played tracks** per player. This ensures:

- No track is repeated within the last 50 autoplay picks
- Deduplication checks both URI and `title::author` key
- History is cleared when autoplay is disabled

## Transition Quality

The scoring system ensures smooth transitions:

```
Anchor: "sea. - สมดุลรัก (Balance)" [Thai pop, SoundCloud]
Currently playing: "sea. - รอยเท้า (Footsteps)"

Candidate A: "STAMP - สาวสาวสาว" (Thai pop)
  → Duration: similar ✓
  → Author: no match, but Thai pop affinity via title keywords ✓
  → Anchor title overlap: partial ✓
  → Score: 72

Candidate B: "M83 - My Tears Are Becoming a Sea (Summit Schranz Edit)"
  → Duration: different ✗
  → Author: no match ✗
  → Anchor author: no match ✗
  → Anchor title: "sea" word match (false positive), low weight
  → Score: 28

Winner: Candidate A ✓
```

## Configuration Tips

- **Enable on the Manager:** Set `autoPlay: true` in Manager options
- **Enable per Player:** Call `player.setAutoplay(true, botUser)` for each player
- **Spotify source manager:** For best results, use a Lavalink server with the Spotify plugin installed. This enables `sprec:` seed-based recommendations.
- **Multiple sources:** Having multiple source managers (Spotify + YouTube + SoundCloud) gives the engine more fallback options
- **Resetting the session:** Call `player.setAutoplay(false, botUser)` then `player.setAutoplay(true, botUser)` to clear the anchor and start a fresh autoplay session

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
[AutoMix] Finding best transition (from: "sea. - สมดุลรัก" by "sea.", avgDur: 284s, seeds: 1)
[AutoMix] Best candidates: "sea. - รอยเท้า" (72pts), "STAMP - สาวสาวสาว" (58pts), ...
[AutoMix] Playing (author mix on soundcloud): "sea. - รอยเท้า" by "sea."
```
