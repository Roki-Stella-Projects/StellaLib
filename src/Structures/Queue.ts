/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * Derived from LithiumX — Copyright (c) 2025 Anantix Network (MIT)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 */
import type { Track, UnresolvedTrack } from "./Types";
import { TrackUtils } from "./Utils";

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
