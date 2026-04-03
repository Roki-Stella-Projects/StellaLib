# Getting Started

This guide walks you through installing StellaLib and building a basic Discord music bot.

## Prerequisites

- **Node.js** >= 18.0.0 (or Bun)
- **A running Lavalink server** (v3.x or v4.x) — [Lavalink setup guide](https://lavalink.dev/getting-started)
- **A Discord bot token** — [Discord Developer Portal](https://discord.com/developers/applications)
- **discord.js** v14+ (or any Discord library that exposes raw gateway events)

## Installation

```bash
npm install @stella_project/stellalib discord.js
# or
yarn add @stella_project/stellalib discord.js
# or
bun add @stella_project/stellalib discord.js
```

## Basic Setup

Every StellaLib bot needs three things:

1. A **Discord client** to connect to Discord
2. A **StellaManager** to connect to Lavalink
3. A **bridge** that forwards raw Discord voice events to the Manager

```ts
import { Client, GatewayIntentBits } from "discord.js";
import { StellaManager } from "@stella_project/stellalib";

// Step 1: Create Discord client with voice intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Step 2: Create the StellaLib manager
const manager = new StellaManager({
  nodes: [
    {
      identifier: "main",
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
    },
  ],
  send(id, payload) {
    const guild = client.guilds.cache.get(id);
    if (guild) guild.shard.send(payload);
  },
});

// Step 3: Bridge raw voice events
client.on("raw", (d) => manager.updateVoiceState(d));

// Step 4: Initialize when bot is ready
client.on("ready", () => {
  console.log(`Logged in as ${client.user?.tag}`);
  manager.init(client.user!.id);
});

client.login("YOUR_BOT_TOKEN");
```

## Playing a Track

Once the manager is initialized and a node is connected, you can play music:

```ts
manager.on("NodeConnect", (node) => {
  console.log(`Connected to node: ${node.options.identifier}`);
});

// In a slash command handler:
async function handlePlay(guildId: string, voiceChannelId: string, textChannelId: string, query: string, userId: string) {
  // Create a player for this guild
  const player = manager.create({
    guild: guildId,
    voiceChannel: voiceChannelId,
    textChannel: textChannelId,
    volume: 50,
    selfDeafen: true,
  });

  // Connect to voice channel
  player.connect();

  // Search for the track
  const result = await manager.search(query, userId);

  if (result.loadType === "error" || result.loadType === "empty") {
    console.log("No results found");
    return;
  }

  // Add to queue
  if (result.loadType === "playlist" && result.playlist) {
    player.queue.add(result.playlist.tracks);
  } else if (result.tracks.length) {
    player.queue.add(result.tracks[0]);
  }

  // Start playback if not already playing
  if (!player.playing && !player.paused) {
    player.play();
  }
}
```

## Handling Events

StellaLib emits events for everything that happens:

```ts
// Track started playing
manager.on("TrackStart", (player, track) => {
  console.log(`Now playing: ${track.title} by ${track.author}`);
});

// Track finished
manager.on("TrackEnd", (player, track, payload) => {
  console.log(`Finished: ${track.title} (reason: ${payload.reason})`);
});

// Queue is empty
manager.on("QueueEnd", (player) => {
  console.log(`Queue ended in guild ${player.guild}`);
  // Optionally destroy the player after a timeout
  setTimeout(() => {
    if (!player.queue.current) player.destroy();
  }, 30000);
});

// Node errors
manager.on("NodeError", (node, error) => {
  console.error(`Error on node ${node.options.identifier}:`, error);
});

// Debug logs (verbose)
manager.on("Debug", (message) => {
  console.debug(message);
});
```

## Graceful Shutdown

Always shut down cleanly to preserve sessions:

```ts
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    console.log("Shutting down...");
    await manager.shutdown();
    client.destroy();
    process.exit(0);
  });
}
```

## Next Steps

- [Architecture](02-architecture.md) — Understand how StellaLib works internally
- [Manager](03-manager.md) — Full Manager API reference
- [Player](05-player.md) — Playback controls, volume, seek, repeat
- [Session Persistence](09-session-persistence.md) — Keep music playing across restarts
- [Filters](08-filters.md) — Audio effects like nightcore, bassboost, 8D
