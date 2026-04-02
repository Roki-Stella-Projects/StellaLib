import { Client, GatewayIntentBits } from "discord.js";
import { StellaManager, FileSessionStore } from "../src";

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
});

const manager = new StellaManager({
	nodes: [
		{
			identifier: "main",
			host: process.env.LAVALINK_HOST!,
			port: Number(process.env.LAVALINK_PORT!),
			password: process.env.LAVALINK_PASSWORD!,
			secure: false,
			resumeStatus: true,
			resumeTimeout: 120,
			heartbeatInterval: 30000,
			requestTimeout: 15000,
		},
	],
	autoPlay: true,
	defaultSearchPlatform: "soundcloud",
	searchFallback: ["youtube music", "youtube", "deezer", "spotify"],
	clientName: "StellaLib/0.0.1 (https://github.com/Roki-Stella-Projects/StellaLib)",
	// Persist sessions to disk so players survive bot restarts
	sessionStore: new FileSessionStore("./sessions.json"),
	// LRU cache: max 200 results, 60s TTL
	caches: { enabled: true, time: 60000, maxSize: 200 },
	send(id, payload) {
		const guild = client.guilds.cache.get(id);
		if (guild) guild.shard.send(payload);
	},
});

// Graceful shutdown — persists sessions so next restart resumes seamlessly
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, async () => {
		console.log(`\n[Shutdown] ${signal} received, persisting sessions...`);
		await manager.shutdown();
		client.destroy();
		process.exit(0);
	});
}

// Forward raw voice events to StellaLib
client.on("raw", (d) => manager.updateVoiceState(d));

// --- Manager Events ---

manager.on("NodeConnect", async (node) => {
	console.log(`[Node] Connected: ${node.options.identifier}`);
	try {
		const sources = await manager.getAvailableSources();
		console.log(`[Node] Sources: ${sources.sourceManagers.join(", ")}`);
		if (sources.plugins.length) {
			console.log(`[Node] Plugins: ${sources.plugins.map((p) => `${p.name}@${p.version}`).join(", ")}`);
		}
	} catch { /* node not ready yet */ }
});

manager.on("NodeReconnect", (node) => {
	console.log(`[Node] Reconnecting: ${node.options.identifier}`);
});

manager.on("NodeDisconnect", (node, reason) => {
	console.log(`[Node] Disconnected: ${node.options.identifier} (${reason.code}: ${reason.reason})`);
});

manager.on("NodeError", (node, error) => {
	console.error(`[Node] Error on ${node.options.identifier}:`, error.message);
});

manager.on("Debug", (message) => {
	console.log(`[Debug] ${message}`);
});

manager.on("TrackStart", (player, track) => {
	console.log(`[Track] Started: ${track.title} by ${track.author}`);
	const channel = client.channels.cache.get(player.textChannel ?? "");
	if (channel?.isTextBased() && "send" in channel) {
		channel.send(`🎶 Now playing: **${track.title}** by **${track.author}**`);
	}
});

manager.on("TrackEnd", (player, track, payload) => {
	console.log(`[Track] Ended: ${track?.title} (reason: ${payload.reason})`);
});

manager.on("TrackError", (player, track, payload) => {
	const exception = (payload as any)?.exception;
	const reason = exception?.message ?? "Unknown error";
	console.error(`[Track] Error: ${reason}`);
	const channel = client.channels.cache.get(player.textChannel ?? "");
	if (channel?.isTextBased() && "send" in channel) {
		channel.send(`❌ Failed to play **${track?.title ?? "track"}**: ${reason}\n${player.queue.size > 0 ? "Skipping to next track..." : ""}`);
	}
	// Auto-skip to next track if queue has more
	if (player.queue.size > 0) {
		player.stop();
	}
});

manager.on("QueueEnd", (player) => {
	console.log(`[Queue] Ended for guild ${player.guild}`);
	const channel = client.channels.cache.get(player.textChannel ?? "");
	if (channel?.isTextBased() && "send" in channel) {
		channel.send("Queue ended. Leaving voice channel.");
	}
	player.destroy();
});

manager.on("SocketClosed", (player, payload) => {
	console.log(`[Socket] Closed for ${player.guild}: code=${payload.code}, reason=${payload.reason}`);
});

// Uncomment for raw payload debugging:
// manager.on("NodeRaw", (payload) => {
// 	console.log(`[Raw]`, JSON.stringify(payload).slice(0, 200));
// });

// --- Bot Ready ---

client.on("clientReady", () => {
	console.log(`Bot ready as ${client.user?.tag}`);
	manager.init(client.user!.id);
});

// --- Message Commands ---

const PREFIX = "!";

client.on("messageCreate", async (message) => {
	if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

	const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
	const command = args.shift()?.toLowerCase();

	if (command === "play") {
		const query = args.join(" ");
		if (!query) return message.reply("Provide a search query or URL.");

		const voiceChannel = message.member?.voice?.channel;
		if (!voiceChannel) return message.reply("Join a voice channel first.");

		let player = manager.get(message.guild.id);
		if (!player) {
			player = manager.create({
				guild: message.guild.id,
				voiceChannel: voiceChannel.id,
				textChannel: message.channel.id,
				selfDeafen: true,
			});
			player.connect();
		}

		// Smart query routing: Spotify URLs pass directly, plain text uses spsearch
		const spotifyUrlRegex = /^https?:\/\/open\.spotify\.com\/(track|album|playlist)\/[\w]+/;
		let searchQuery: string | { source: string; query: string } = query;

		if (spotifyUrlRegex.test(query)) {
			// Spotify URLs — pass directly, LavaSrc resolves natively
			searchQuery = query;
		} else if (!query.startsWith("http")) {
			// Plain text — search on Spotify first
			searchQuery = { source: "spotify", query };
		}

		let res = await manager.search(searchQuery, message.author.id);
		console.log(`[Search] loadType=${res.loadType}, tracks=${res.tracks.length}, source=${res.tracks[0]?.sourceName ?? "N/A"}`);

		// If Spotify search returned nothing, fall back to SoundCloud then YouTube
		if ((res.loadType === "empty" || res.loadType === "error" || res.tracks.length === 0) && !query.startsWith("http")) {
			console.log(`[Search] Spotify search failed, trying SoundCloud...`);
			res = await manager.search({ source: "soundcloud", query }, message.author.id);
			if (res.loadType === "empty" || res.loadType === "error" || res.tracks.length === 0) {
				console.log(`[Search] SoundCloud failed, trying YouTube Music...`);
				res = await manager.search({ source: "youtube music", query }, message.author.id);
			}
		}

		if (res.loadType === "empty" || res.loadType === "error" || res.tracks.length === 0) {
			return message.reply("No results found.");
		}

		if (res.loadType === "playlist" && res.playlist) {
			player.queue.add(res.playlist.tracks);
			message.reply(`Added playlist **${res.playlist.name}** (${res.playlist.tracks.length} tracks)`);
		} else {
			player.queue.add(res.tracks[0]);
			message.reply(`Added **${res.tracks[0].title}** by **${res.tracks[0].author}** to the queue.`);
		}

		if (!player.playing && !player.paused && player.queue.totalSize) {
			player.play();
		}
	}

	if (command === "skip") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("Nothing is playing.");
		player.stop();
		message.reply("Skipped.");
	}

	if (command === "stop") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("Nothing is playing.");
		player.destroy();
		message.reply("Stopped and left the channel.");
	}

	if (command === "pause") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("Nothing is playing.");
		player.pause(!player.paused);
		message.reply(player.paused ? "Paused." : "Resumed.");
	}

	if (command === "autoplay" || command === "ap") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("Nothing is playing.");
		const newState = !player.isAutoplay;
		player.setAutoplay(newState, { id: message.author.id, tag: message.author.tag });
		message.reply(
			newState
				? "🔄 **Autoplay ON** — I'll keep playing similar tracks 24/7 when the queue ends!"
				: "⏹️ **Autoplay OFF** — I'll stop when the queue ends.",
		);
	}

	if (command === "queue") {
		const player = manager.get(message.guild.id);
		if (!player || !player.queue.current) return message.reply("Nothing is playing.");

		const current = player.queue.current;
		const upcoming = player.queue.slice(0, 10);
		const lines = [
			`**Now Playing:** ${current.title} by ${current.author}`,
			...upcoming.map((t, i) => `${i + 1}. ${t.title} by ${t.author}`),
		];
		if (player.queue.size > 10) lines.push(`...and ${player.queue.size - 10} more`);
		message.reply(lines.join("\n"));
	}

	if (command === "volume") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("Nothing is playing.");
		const vol = parseInt(args[0]);
		if (isNaN(vol) || vol < 0 || vol > 200) return message.reply("Volume must be 0-200.");
		player.setVolume(vol);
		message.reply(`Volume set to **${vol}**.`);
	}

	if (command === "shuffle") {
		const player = manager.get(message.guild.id);
		if (!player || !player.queue.size) return message.reply("Not enough tracks to shuffle.");
		player.queue.shuffle();
		message.reply("Queue shuffled.");
	}

	if (command === "loop") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("Nothing is playing.");
		const mode = args[0]?.toLowerCase();
		if (mode === "track") {
			player.setTrackRepeat(!player.trackRepeat);
			message.reply(`Track loop: **${player.trackRepeat ? "ON" : "OFF"}**`);
		} else if (mode === "queue") {
			player.setQueueRepeat(!player.queueRepeat);
			message.reply(`Queue loop: **${player.queueRepeat ? "ON" : "OFF"}**`);
		} else {
			message.reply("Usage: `!loop track` or `!loop queue`");
		}
	}

	if (command === "filter") {
		const player = manager.get(message.guild.id);
		if (!player) return message.reply("Nothing is playing.");
		const filterName = args[0]?.toLowerCase();
		const validFilters = ["bassboost", "nightcore", "vaporwave", "eightD", "slowmo", "soft", "trebleBass", "tv", "distort"];
		if (!filterName || !validFilters.includes(filterName)) {
			return message.reply(`Valid filters: ${validFilters.join(", ")}`);
		}
		const status = player.filters.getFilterStatus(filterName as any);
		await player.filters.setFilter(filterName, !status);
		message.reply(`Filter **${filterName}**: **${!status ? "ON" : "OFF"}**`);
	}

	if (command === "sources") {
		try {
			const { sourceManagers, plugins } = await manager.getAvailableSources();
			const lines = [
				`**Lavalink Source Managers:**`,
				sourceManagers.length ? sourceManagers.map((s) => `\`${s}\``).join(", ") : "None",
				`\n**Plugins:**`,
				plugins.length ? plugins.map((p) => `\`${p.name}@${p.version}\``).join(", ") : "None",
			];
			message.reply(lines.join("\n"));
		} catch (err) {
			message.reply(`Error: ${(err as Error).message}`);
		}
	}

	if (command === "stats") {
		const stats = manager.getStats();
		const lines = [
			`**StellaLib Stats**`,
			`Players: ${stats.totalPlayers} (${stats.totalPlayingPlayers} playing)`,
			`Cache: ${stats.cacheSize} entries (~${Math.round(stats.cacheMemoryEstimate / 1024)}KB)`,
			...stats.nodes.map((n) =>
				`Node **${n.identifier}**: ${n.connected ? "✅" : "❌"} | ${n.players} players | penalty: ${Math.round(n.penalties)} | REST: ${n.restRequests} req (${n.restFailed} failed) | mem: ${Math.round(n.memory.used / 1024 / 1024)}MB`
			),
		];
		message.reply(lines.join("\n"));
	}

	if (command === "nowplaying" || command === "np") {
		const player = manager.get(message.guild.id);
		if (!player || !player.queue.current) return message.reply("Nothing is playing.");
		const track = player.queue.current;
		const pos = Math.floor(player.position / 1000);
		const dur = Math.floor((track.duration ?? 0) / 1000);
		message.reply(
			`**${track.title}** by **${track.author}**\n` +
			`${formatTime(pos)} / ${formatTime(dur)} | Volume: ${player.volume}`
		);
	}
});

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

// Login
const token = process.env.DISCORD_TOKEN;
if (!token) {
	console.error("DISCORD_TOKEN environment variable is required.");
	process.exit(1);
}
client.login(token);
