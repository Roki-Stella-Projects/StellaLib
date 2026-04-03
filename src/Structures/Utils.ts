/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * Derived from LithiumX — Copyright (c) 2025 Anantix Network (MIT)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 */
import type {
	Track,
	UnresolvedTrack,
	UnresolvedQuery,
	Sizes,
	TrackData,
	TrackSourceName,
	NodeStats,
} from "./Types";

/** @hidden */
const TRACK_SYMBOL = Symbol("track"),
	/** @hidden */
	UNRESOLVED_TRACK_SYMBOL = Symbol("unresolved"),
	SIZES = ["0", "1", "2", "3", "default", "mqdefault", "hqdefault", "maxresdefault"];

/** @hidden */
const escapeRegExp = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

abstract class TrackUtils {
	static trackPartial: string[] | null = null;
	private static manager: any;

	/** @hidden */
	public static init(manager: any): void {
		this.manager = manager;
	}

	static setTrackPartial(partial: string[]): void {
		if (!Array.isArray(partial) || !partial.every((str) => typeof str === "string"))
			throw new Error("Provided partial is not an array or not a string array.");
		if (!partial.includes("track")) partial.unshift("track");
		this.trackPartial = partial;
	}

	/**
	 * Checks if the provided argument is a valid Track or UnresolvedTrack.
	 * If provided an array then every element will be checked.
	 */
	static validate(trackOrTracks: unknown): boolean {
		if (typeof trackOrTracks === "undefined")
			throw new RangeError("Provided argument must be present.");

		if (Array.isArray(trackOrTracks) && trackOrTracks.length) {
			for (const track of trackOrTracks) {
				if (!(track[TRACK_SYMBOL] || track[UNRESOLVED_TRACK_SYMBOL])) return false;
			}
			return true;
		}

		return (
			(trackOrTracks as Record<symbol, boolean>)[TRACK_SYMBOL] ||
			(trackOrTracks as Record<symbol, boolean>)[UNRESOLVED_TRACK_SYMBOL]
		) === true;
	}

	/** Checks if the provided argument is a valid UnresolvedTrack. */
	static isUnresolvedTrack(track: unknown): boolean {
		if (typeof track === "undefined")
			throw new RangeError("Provided argument must be present.");
		return (track as Record<symbol, boolean>)[UNRESOLVED_TRACK_SYMBOL] === true;
	}

	/** Checks if the provided argument is a valid Track. */
	static isTrack(track: unknown): boolean {
		if (typeof track === "undefined")
			throw new RangeError("Provided argument must be present.");
		return (track as Record<symbol, boolean>)[TRACK_SYMBOL] === true;
	}

	/**
	 * Builds a Track from the raw data from Lavalink and an optional requester.
	 * @param data The raw data from Lavalink.
	 * @param requester The user who requested the track.
	 */
	static build(data: TrackData, requester?: string): Track {
		if (typeof data === "undefined")
			throw new RangeError('Argument "data" must be present.');

		try {
			const track: Track = {
				track: data.encoded,
				title: data.info.title,
				identifier: data.info.identifier,
				author: data.info.author,
				duration: data.info.length,
				isrc: data.info?.isrc ?? "",
				isSeekable: data.info.isSeekable,
				isStream: data.info.isStream,
				uri: data.info.uri ?? "",
				artworkUrl: data.info?.artworkUrl ?? "",
				sourceName: data.info?.sourceName ?? "unknown",
				thumbnail: data.info.uri?.includes("youtube")
					? `https://img.youtube.com/vi/${data.info.identifier}/default.jpg`
					: null,
				displayThumbnail(size = "default"): string | null {
					const finalSize = SIZES.find((s) => s === size) ?? "default";
					return this.uri?.includes("youtube")
						? `https://img.youtube.com/vi/${data.info.identifier}/${finalSize}.jpg`
						: null;
				},
				requester,
				pluginInfo: data.pluginInfo ?? {},
				customData: {},
			};

			track.displayThumbnail = track.displayThumbnail.bind(track);

			if (this.trackPartial) {
				for (const key of Object.keys(track)) {
					if (this.trackPartial.includes(key)) continue;
					delete (track as unknown as Record<string, unknown>)[key];
				}
			}

			Object.defineProperty(track, TRACK_SYMBOL, {
				configurable: true,
				value: true,
			});

			return track;
		} catch (error) {
			throw new RangeError(
				`Argument "data" is not a valid track: ${(error as Error).message}`,
			);
		}
	}

	/**
	 * Builds an UnresolvedTrack to be resolved before being played.
	 * @param query The query to search for.
	 * @param requester The user who requested the track.
	 */
	static buildUnresolved(query: string | UnresolvedQuery, requester?: string): UnresolvedTrack {
		if (typeof query === "undefined")
			throw new RangeError('Argument "query" must be present.');

		let unresolvedTrack: Partial<UnresolvedTrack> = {
			requester,
			async resolve(): Promise<void> {
				const resolved = await TrackUtils.getClosestTrack(this as UnresolvedTrack);
				Object.getOwnPropertyNames(this).forEach((prop) => delete (this as Record<string, unknown>)[prop]);
				Object.assign(this, resolved);
			},
		};

		if (typeof query === "string") unresolvedTrack.title = query;
		else unresolvedTrack = { ...unresolvedTrack, ...query };

		Object.defineProperty(unresolvedTrack, UNRESOLVED_TRACK_SYMBOL, {
			configurable: true,
			value: true,
		});

		return unresolvedTrack as UnresolvedTrack;
	}

	static async getClosestTrack(unresolvedTrack: UnresolvedTrack): Promise<Track> {
		if (!TrackUtils.manager) throw new RangeError("Manager has not been initiated.");
		if (!TrackUtils.isUnresolvedTrack(unresolvedTrack))
			throw new RangeError("Provided track is not an UnresolvedTrack.");

		const query = unresolvedTrack.uri
			? unresolvedTrack.uri
			: [unresolvedTrack.author, unresolvedTrack.title].filter(Boolean).join(" - ");
		const res = await TrackUtils.manager.search(query, unresolvedTrack.requester ?? undefined);

		if (unresolvedTrack.author) {
			const channelNames = [unresolvedTrack.author, `${unresolvedTrack.author} - Topic`];
			const originalAudio = res.tracks.find((track: Track) => {
				return (
					channelNames.some(
						(name) => new RegExp(`^${escapeRegExp(name)}$`, "i").test(track.author),
					) ||
					new RegExp(`^${escapeRegExp(unresolvedTrack.title)}$`, "i").test(track.title)
				);
			});
			if (originalAudio) return originalAudio;
		}

		if (unresolvedTrack.duration) {
			const sameDuration = res.tracks.find(
				(track: Track) =>
					track.duration >= (unresolvedTrack.duration! - 1500) &&
					track.duration <= (unresolvedTrack.duration! + 1500),
			);
			if (sameDuration) return sameDuration;
		}

		const finalTrack = res.tracks[0];
		if (finalTrack) finalTrack.customData = unresolvedTrack.customData ?? {};
		return finalTrack;
	}
}

/** Gets or extends structures to extend the built in, or already extended, classes to add more functionality. */
abstract class Structure {
	/**
	 * Extends a class.
	 * @param name
	 * @param extender
	 */
	public static extend<K extends keyof Extendable, T extends Extendable[K]>(
		name: K,
		extender: (target: Extendable[K]) => T,
	): T {
		const s = getStructures();
		if (!s[name]) throw new TypeError(`"${name}" is not a valid structure`);
		const extended = extender(s[name]);
		s[name] = extended;
		return extended;
	}

	/**
	 * Get a structure from available structures by name.
	 * @param name
	 */
	public static get<K extends keyof Extendable>(name: K): Extendable[K] {
		const structure = getStructures()[name];
		if (!structure) throw new TypeError('"structure" must be provided.');
		return structure;
	}
}

class Plugin {
	public load(_manager: any): void {}
	public unload(_manager: any): void {}
}

interface Extendable {
	Player: any;
	Queue: any;
	Node: any;
}

const structures: Extendable = {} as Extendable;

/** Lazily initializes the structures object to avoid circular dependency issues. */
function getStructures(): Extendable {
	if (!structures.Player) {
		structures.Player = require("./Player").StellaPlayer;
		structures.Queue = require("./Queue").StellaQueue;
		structures.Node = require("./Node").StellaNode;
	}
	return structures;
}

/**
 * Type guard: checks if an object implements the PlayerStateStore interface.
 * Useful for validating custom stores before passing them to ManagerOptions.
 */
function isPlayerStateStore(obj: unknown): boolean {
	if (!obj || typeof obj !== "object") return false;
	const o = obj as Record<string, unknown>;
	return (
		typeof o.getPlayerState === "function" &&
		typeof o.setPlayerState === "function" &&
		typeof o.deletePlayerState === "function" &&
		typeof o.getAllPlayerStates === "function"
	);
}

export {
	TrackUtils,
	Structure,
	Plugin,
	Extendable,
	isPlayerStateStore,
};
