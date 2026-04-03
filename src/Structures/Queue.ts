/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * Derived from LithiumX — Copyright (c) 2025 Anantix Network (MIT)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 */
import type { Track, UnresolvedTrack } from "./Types";
import { TrackUtils } from "./Utils";

/** Marker symbol indicating a track has been compacted (heavy fields stripped). */
const COMPACTED = Symbol.for("StellaLib.compacted");

/**
 * The player's queue. The `current` property is the currently playing track,
 * think of the rest as the upcoming tracks.
 */
export class StellaQueue extends Array<Track | UnresolvedTrack> {
	/** The total duration of the queue including the current track. */
	public get duration(): number {
		const current = this.current?.duration ?? 0;
		return this.reduce((acc, cur) => acc + (cur.duration || 0), current);
	}

	/** The total size of tracks in the queue including the current track. */
	public get totalSize(): number {
		return this.length + (this.current ? 1 : 0);
	}

	/** The size of tracks in the queue (excluding current). */
	public get size(): number {
		return this.length;
	}

	/** The current track. */
	public current: Track | UnresolvedTrack | null = null;

	/** The previous track. */
	public previous: Track | UnresolvedTrack | null = null;

	/** Maximum queue size (0 = unlimited). Set by Player. */
	public maxSize = 0;

	/** Whether to prevent duplicate tracks from being added. */
	public noDuplicates = false;

	/**
	 * Adds a track to the queue.
	 * @param track The track or array of tracks to add.
	 * @param offset Optional position to insert at.
	 */
	public add(
		track: (Track | UnresolvedTrack) | (Track | UnresolvedTrack)[],
		offset?: number,
	): void {
		if (!TrackUtils.validate(track))
			throw new RangeError('Track must be a "Track" or "Track[]".');

		// Deduplication: filter out tracks already in the queue or currently playing
		if (this.noDuplicates) {
			if (Array.isArray(track)) {
				track = track.filter((t) => !this.isDuplicate(t));
				if (!track.length) return;
			} else {
				if (this.isDuplicate(track)) return;
			}
		}

		// Max size enforcement
		if (this.maxSize > 0 && this.current) {
			const incoming = Array.isArray(track) ? track.length : 1;
			const available = this.maxSize - this.length;
			if (available <= 0) {
				throw new RangeError(`Queue is full (${this.maxSize} tracks max).`);
			}
			if (incoming > available) {
				if (Array.isArray(track)) {
					track = track.slice(0, available);
				}
			}
		}

		if (!this.current) {
			if (Array.isArray(track)) {
				this.current = track.shift() || null;
				this.push(...track);
			} else {
				this.current = track;
			}
		} else {
			if (typeof offset !== "undefined" && typeof offset === "number") {
				if (isNaN(offset))
					throw new RangeError("Offset must be a number.");
				if (offset < 0 || offset > this.length)
					throw new RangeError(`Offset must be between 0 and ${this.length}.`);

				if (Array.isArray(track)) {
					this.splice(offset, 0, ...track);
				} else {
					this.splice(offset, 0, track);
				}
			} else {
				if (Array.isArray(track)) {
					this.push(...track);
				} else {
					this.push(track);
				}
			}
		}
	}

	/**
	 * Checks if a track is already in the queue or is currently playing.
	 * Matches by URI first, then by title+author combo.
	 */
	public isDuplicate(track: Track | UnresolvedTrack): boolean {
		const uri = (track as Track).uri;
		const key = `${track.title}::${track.author}`;

		// Check current track
		if (this.current) {
			const curUri = (this.current as Track).uri;
			if (uri && curUri && uri === curUri) return true;
			if (`${this.current.title}::${this.current.author}` === key) return true;
		}

		// Check queued tracks
		return this.some((t) => {
			const tUri = (t as Track).uri;
			if (uri && tUri && uri === tUri) return true;
			return `${t.title}::${t.author}` === key;
		});
	}

	/**
	 * Removes a track from the queue by position.
	 * Defaults to the first track, returning the removed track(s).
	 */
	public remove(position?: number): (Track | UnresolvedTrack)[];

	/**
	 * Removes tracks using a start and end index, returning the removed tracks.
	 */
	public remove(start: number, end: number): (Track | UnresolvedTrack)[];

	public remove(startOrPosition = 0, end?: number): (Track | UnresolvedTrack)[] {
		if (typeof end !== "undefined") {
			if (isNaN(Number(startOrPosition)) || isNaN(Number(end)))
				throw new RangeError('Missing "start" or "end" parameter.');
			if (startOrPosition >= end || startOrPosition >= this.length)
				throw new RangeError("Invalid start or end values.");
			return this.splice(startOrPosition, end - startOrPosition);
		}
		return this.splice(startOrPosition, 1);
	}

	/** Clears the queue. */
	public clear(): void {
		this.splice(0);
	}

	// ── Memory Optimization (Track Serialization) ───────────────────────

	/**
	 * Compacts the queue to reduce RAM usage.
	 * Strips heavy metadata (pluginInfo, customData, thumbnail, artworkUrl, isrc)
	 * from all queued tracks, keeping only what's needed for playback:
	 * `track` (encoded base64), `title`, `author`, `duration`, `uri`, `sourceName`.
	 *
	 * At 700+ servers with 50-track queues, this can reduce RAM by 50-70%.
	 * Compacted tracks can still be played normally — Lavalink only needs the
	 * `encoded` string. UI display may lose artwork until the track is expanded.
	 *
	 * @returns Number of tracks compacted.
	 */
	public compactQueue(): number {
		let compacted = 0;
		for (let i = 0; i < this.length; i++) {
			const track = this[i] as Track & { [COMPACTED]?: boolean };
			if (!track.track || track[COMPACTED]) continue;

			// Strip heavy fields by replacing with a minimal object
			const minimal = {
				track: track.track,
				title: track.title,
				author: track.author,
				duration: track.duration,
				uri: track.uri,
				sourceName: track.sourceName,
				identifier: track.identifier,
				isSeekable: track.isSeekable,
				isStream: track.isStream,
				isrc: "",
				artworkUrl: "",
				thumbnail: null,
				requester: track.requester,
				pluginInfo: {} as Track["pluginInfo"],
				customData: {},
				displayThumbnail: () => null,
				[COMPACTED]: true,
			} as unknown as Track;

			this[i] = minimal;
			compacted++;
		}
		return compacted;
	}

	/**
	 * Returns true if a track has been compacted (heavy metadata stripped).
	 */
	public static isCompacted(track: Track | UnresolvedTrack): boolean {
		return !!(track as any)[COMPACTED];
	}

	/**
	 * Estimates the memory usage of the queue in bytes.
	 * Useful for monitoring and deciding when to call `compactQueue()`.
	 */
	public get memoryEstimate(): number {
		let bytes = 0;
		const estimate = (t: Track | UnresolvedTrack | null) => {
			if (!t) return 0;
			let size = 200; // base object overhead
			if ((t as Track).track) size += (t as Track).track.length * 2;
			if (t.title) size += t.title.length * 2;
			if (t.author) size += t.author.length * 2;
			if ((t as Track).uri) size += (t as Track).uri.length * 2;
			if ((t as Track).isrc) size += (t as Track).isrc.length * 2;
			if ((t as Track).artworkUrl) size += (t as Track).artworkUrl.length * 2;
			if ((t as Track).pluginInfo) size += JSON.stringify((t as Track).pluginInfo).length * 2;
			if ((t as Track).customData) size += JSON.stringify((t as Track).customData).length * 2;
			return size;
		};

		bytes += estimate(this.current);
		bytes += estimate(this.previous);
		for (const track of this) {
			bytes += estimate(track);
		}
		return bytes;
	}

	/** Shuffles the queue using the Fisher-Yates algorithm. */
	public shuffle(): void {
		for (let i = this.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[this[i], this[j]] = [this[j], this[i]];
		}
	}

	/**
	 * Shuffles the queue but distributes tracks evenly by requester,
	 * so no single user dominates the upcoming tracks.
	 */
	public equalizedShuffle(): void {
		const userTracks = new Map<string | null | undefined, Array<Track | UnresolvedTrack>>();
		this.forEach((track) => {
			const user = track.requester;
			if (!userTracks.has(user)) userTracks.set(user, []);
			userTracks.get(user)!.push(track);
		});

		const shuffledQueue: Array<Track | UnresolvedTrack> = [];
		const totalLength = this.length;
		while (shuffledQueue.length < totalLength) {
			userTracks.forEach((tracks) => {
				const track = tracks.shift();
				if (track) shuffledQueue.push(track);
			});
		}

		this.clear();
		this.add(shuffledQueue);
	}
}
