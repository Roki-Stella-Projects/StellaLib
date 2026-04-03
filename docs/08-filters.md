# Filters

`StellaFilters` manages audio effects for a player. Each player has its own `filters` instance.

## Using Filters

```ts
// Enable a filter
await player.filters.setFilter("nightcore", true);

// Disable a filter
await player.filters.setFilter("nightcore", false);

// Clear all filters
await player.filters.clearFilters();
```

## Available Presets

| Preset | Effect | What it changes |
|---|---|---|
| `bassboost` | Boosts low frequencies | Equalizer: bands 0-5 boosted |
| `nightcore` | Speeds up + higher pitch | Timescale: speed 1.3, pitch 1.3, rate 1.0 |
| `vaporwave` | Slows down + lower pitch | Timescale: speed 0.85, pitch 0.9, rate 1.0 |
| `eightD` | Rotating stereo panning | Rotation: rotationHz 0.2 |
| `slowmo` | Slower playback | Timescale: speed 0.7, pitch 1.0, rate 0.8 |
| `soft` | Reduces harsh frequencies | Equalizer: gentle mid-range cuts |
| `trebleBass` | Boosts highs and lows | Equalizer: bands 0-2 and 10-14 boosted |
| `tv` | Tinny speaker simulation | Equalizer: cuts lows and highs, boosts mids |
| `distort` | Audio distortion | Distortion: various offset/scale values |

## How Filters Work

When you set a filter, StellaLib:

1. Looks up the preset's parameters (equalizer bands, timescale values, rotation, etc.)
2. Merges them with any other active filters
3. Sends the combined filter state to Lavalink:
   - **v4:** `PATCH /v4/sessions/{sid}/players/{guildId}` with `{ filters: { ... } }`
   - **v3:** WS op `{ op: "filters", guildId, ... }` with all filter parameters

Multiple filters can be active simultaneously. For example, `nightcore` + `bassboost` applies both timescale changes and equalizer boosts.

## Lavalink Filter Parameters

Under the hood, Lavalink supports these filter types:

### Equalizer

15 bands (0-14) with gain from -0.25 to 1.0. Band 0 is the lowest frequency (25Hz), band 14 is the highest (16kHz).

```ts
// The bassboost preset applies something like:
// Band 0: 0.6, Band 1: 0.67, Band 2: 0.67, Band 3: 0.4, ...
```

### Timescale

Controls speed, pitch, and rate independently.

| Parameter | Default | Description |
|---|---|---|
| `speed` | 1.0 | Playback speed multiplier |
| `pitch` | 1.0 | Audio pitch multiplier |
| `rate` | 1.0 | Audio rate multiplier |

### Rotation

Rotates the audio around the stereo field.

| Parameter | Default | Description |
|---|---|---|
| `rotationHz` | 0.0 | Rotation speed in Hz (0 = disabled) |

### Distortion

Applies audio distortion effects.

| Parameter | Description |
|---|---|
| `sinOffset` | Sine wave offset |
| `sinScale` | Sine wave scale |
| `cosOffset` | Cosine wave offset |
| `cosScale` | Cosine wave scale |
| `tanOffset` | Tangent wave offset |
| `tanScale` | Tangent wave scale |
| `offset` | Global offset |
| `scale` | Global scale |

### Other (Lavalink-native)

Lavalink also supports these filters natively, which can be sent via the REST/WS API:

- **Karaoke** — Removes vocals
- **Tremolo** — Volume oscillation
- **Vibrato** — Pitch oscillation
- **Channel Mix** — Stereo channel mixing
- **Low Pass** — Cuts high frequencies

## Combining Filters

Filters stack together. If two presets modify different parameters, both apply. If two presets modify the same parameter (e.g., both change timescale), the last one set wins for that parameter.

```ts
// Both active simultaneously
await player.filters.setFilter("bassboost", true);   // Equalizer
await player.filters.setFilter("eightD", true);      // Rotation
// Result: boosted bass + rotating stereo

// Nightcore overrides vaporwave's timescale
await player.filters.setFilter("vaporwave", true);    // Timescale: speed 0.85
await player.filters.setFilter("nightcore", true);    // Timescale: speed 1.3 (overrides)
```

## Clearing Filters

```ts
// Remove all filters — resets to default audio
await player.filters.clearFilters();
```

This sends an empty filter state to Lavalink, removing all equalizer, timescale, rotation, and distortion effects.
