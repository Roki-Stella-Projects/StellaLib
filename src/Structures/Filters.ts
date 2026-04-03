/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * Derived from LithiumX — Copyright (c) 2025 Anantix Network (MIT)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 */
import {
	Band,
	bassBoostEqualizer,
	softEqualizer,
	trebleBassEqualizer,
	tvEqualizer,
	vaporwaveEqualizer,
} from "../Utils/FiltersEqualizers";
class Filters {
	public distortion: DistortionOptions | null;
	public equalizer: Band[];
	public karaoke: KaraokeOptions | null;
	public player: any;
	public rotation: RotationOptions | null;
	public timescale: TimescaleOptions | null;
	public vibrato: VibratoOptions | null;
	public volume: number;

	private filterStatus: Record<string, boolean>;

	constructor(player: any) {
		this.distortion = null;
		this.equalizer = [];
		this.karaoke = null;
		this.player = player;
		this.rotation = null;
		this.timescale = null;
		this.vibrato = null;
		this.volume = 1.0;

		this.filterStatus = {
			bassboost: false,
			distort: false,
			eightD: false,
			karaoke: false,
			nightcore: false,
			slowmo: false,
			soft: false,
			trebleBass: false,
			tv: false,
			vaporwave: false,
		};
	}

	private async updateFilters(): Promise<this> {
		const { distortion, equalizer, karaoke, rotation, timescale, vibrato, volume } = this;

		await this.player.node.rest.updatePlayer({
			guildId: this.player.guild,
			data: {
				filters: {
					distortion,
					equalizer,
					karaoke,
					rotation,
					timescale,
					vibrato,
					volume,
				},
			},
		});

		return this;
	}

	private applyFilter<T extends keyof Filters>(
		filter: { property: T; value: Filters[T] },
		shouldUpdate = true,
	): this {
		this[filter.property] = filter.value as this[T];
		if (shouldUpdate) {
			this.updateFilters();
		}
		return this;
	}

	private setFilterStatus(filter: keyof AvailableFilters, status: boolean): this {
		this.filterStatus[filter] = status;
		return this;
	}

	/**
	 * Sets the equalizer bands and updates the filters.
	 * @param bands The equalizer bands.
	 */
	public setEqualizer(bands?: Band[]): this {
		return this.applyFilter({ property: "equalizer", value: bands ?? [] });
	}

	/** Applies the distortion audio effect. */
	public distort(): this {
		return this.setDistortion({
			sinOffset: 0,
			sinScale: 0.2,
			cosOffset: 0,
			cosScale: 0.2,
			tanOffset: 0,
			tanScale: 0.2,
			offset: 0,
			scale: 1.2,
		}).setFilterStatus("distort", true);
	}

	/** Applies the karaoke options specified by the filter. */
	public setKaraoke(status: boolean, karaoke?: KaraokeOptions): this {
		return this.applyFilter({
			property: "karaoke",
			value: karaoke ?? null,
		}).setFilterStatus("karaoke", status);
	}

	/** Applies the timescale options specified by the filter. */
	public setTimescale(timescale?: TimescaleOptions | null): this {
		return this.applyFilter({ property: "timescale", value: timescale ?? null });
	}

	/** Applies the vibrato options specified by the filter. */
	public setVibrato(vibrato?: VibratoOptions | null): this {
		return this.applyFilter({ property: "vibrato", value: vibrato ?? null });
	}

	/** Applies the rotation options specified by the filter. */
	public setRotation(rotation?: RotationOptions | null): this {
		return this.applyFilter({ property: "rotation", value: rotation ?? null });
	}

	/** Applies the distortion options specified by the filter. */
	public setDistortion(distortion?: DistortionOptions | null): this {
		return this.applyFilter({ property: "distortion", value: distortion ?? null });
	}

	/**
	 * Set the 8D audio effect.
	 * @param status Whether to enable or disable.
	 */
	public setEightD(status: boolean): this {
		if (status) {
			return this.setRotation({ rotationHz: 0.2 }).setFilterStatus("eightD", status);
		} else {
			return this.setRotation(null).setFilterStatus("eightD", status);
		}
	}

	/**
	 * Set the nightcore effect.
	 * @param status Whether to enable or disable.
	 */
	public setNightcore(status: boolean): this {
		if (status) {
			return this.setTimescale({
				speed: 1.1,
				pitch: 1.125,
				rate: 1.05,
			}).setFilterStatus("nightcore", status);
		} else {
			return this.setTimescale(null).setFilterStatus("nightcore", status);
		}
	}

	/**
	 * Set the slowmo effect.
	 * @param status Whether to enable or disable.
	 */
	public setSlowmo(status: boolean): this {
		if (status) {
			return this.setTimescale({
				speed: 0.7,
				pitch: 1.0,
				rate: 0.8,
			}).setFilterStatus("slowmo", status);
		} else {
			return this.setTimescale(null).setFilterStatus("slowmo", status);
		}
	}

	/**
	 * Set the soft effect.
	 * @param status Whether to enable or disable.
	 */
	public setSoft(status: boolean): this {
		if (status) {
			return this.setEqualizer(softEqualizer).setFilterStatus("soft", status);
		} else {
			return this.setEqualizer([]).setFilterStatus("soft", status);
		}
	}

	/**
	 * Set the treble bass effect.
	 * @param status Whether to enable or disable.
	 */
	public setTrebleBass(status: boolean): this {
		if (status) {
			return this.setEqualizer(trebleBassEqualizer).setFilterStatus("trebleBass", status);
		} else {
			return this.setEqualizer([]).setFilterStatus("trebleBass", status);
		}
	}

	/**
	 * Set the TV effect.
	 * @param status Whether to enable or disable.
	 */
	public setTV(status: boolean): this {
		if (status) {
			return this.setEqualizer(tvEqualizer).setFilterStatus("tv", status);
		} else {
			return this.setEqualizer([]).setFilterStatus("tv", status);
		}
	}

	/**
	 * Set the vaporwave effect.
	 * @param status Whether to enable or disable.
	 */
	public setVaporwave(status: boolean): this {
		if (status) {
			return this.setEqualizer(vaporwaveEqualizer)
				.setTimescale({ pitch: 0.55 })
				.setFilterStatus("vaporwave", status);
		} else {
			return this.setEqualizer([])
				.setTimescale(null)
				.setFilterStatus("vaporwave", status);
		}
	}

	/**
	 * Set the bass boost effect.
	 * @param status Whether to enable or disable.
	 */
	public setBassBoost(status: boolean): this {
		if (status) {
			return this.setEqualizer(bassBoostEqualizer).setFilterStatus("bassboost", status);
		} else {
			return this.setEqualizer([]).setFilterStatus("bassboost", status);
		}
	}

	/**
	 * Set the distort effect.
	 * @param status Whether to enable or disable.
	 */
	public setDistort(status: boolean): this {
		if (status) {
			return this.setDistortion({
				sinOffset: 0,
				sinScale: 0.2,
				cosOffset: 0,
				cosScale: 0.2,
				tanOffset: 0,
				tanScale: 0.2,
				offset: 0,
				scale: 1.2,
			}).setFilterStatus("distort", status);
		} else {
			return this.setDistortion(null).setFilterStatus("distort", status);
		}
	}

	/**
	 * Set a filter by name.
	 * @param filter The filter name.
	 * @param status Whether to enable or disable.
	 */
	public async setFilter(filter: keyof AvailableFilters | string, status: boolean): Promise<this> {
		if (typeof status !== "boolean") throw new Error("Status must be a boolean");

		switch (filter) {
			case "bassboost": this.setBassBoost(status); break;
			case "distort": this.setDistort(status); break;
			case "eightD": this.setEightD(status); break;
			case "nightcore": this.setNightcore(status); break;
			case "slowmo": this.setSlowmo(status); break;
			case "soft": this.setSoft(status); break;
			case "trebleBass": this.setTrebleBass(status); break;
			case "tv": this.setTV(status); break;
			case "vaporwave": this.setVaporwave(status); break;
			default: throw new Error(`Invalid filter: "${filter}"`);
		}

		await this.updateFilters();
		return this;
	}

	/** Removes all audio effects and resets the filter status. */
	public async clearFilters(): Promise<this> {
		this.filterStatus = {
			bassboost: false,
			distort: false,
			eightD: false,
			karaoke: false,
			nightcore: false,
			slowmo: false,
			soft: false,
			trebleBass: false,
			tv: false,
			vaporwave: false,
		};

		this.player.filters = new Filters(this.player);
		this.setEqualizer([]);
		this.setDistortion(null);
		this.setKaraoke(false);
		this.setRotation(null);
		this.setTimescale(null);
		this.setVibrato(null);

		await this.updateFilters();
		return this;
	}

	/** Returns the status of the specified filter. */
	public getFilterStatus(filter: keyof AvailableFilters): boolean {
		return this.filterStatus[filter];
	}

	/** Returns a copy of all filter statuses (for persistence). */
	public getActiveFilters(): Record<string, boolean> {
		return { ...this.filterStatus };
	}

	/**
	 * Restores filter state from persisted data (used after bot restart).
	 * Re-applies all active filters without sending to Lavalink yet.
	 */
	public restoreState(state: {
		distortion: object | null;
		equalizer: object[];
		karaoke: object | null;
		rotation: object | null;
		timescale: object | null;
		vibrato: object | null;
		volume: number;
		activeFilters: Record<string, boolean>;
	}): void {
		this.distortion = state.distortion as DistortionOptions | null;
		this.equalizer = (state.equalizer ?? []) as Band[];
		this.karaoke = state.karaoke as KaraokeOptions | null;
		this.rotation = state.rotation as RotationOptions | null;
		this.timescale = state.timescale as TimescaleOptions | null;
		this.vibrato = state.vibrato as VibratoOptions | null;
		this.volume = state.volume ?? 1.0;
		if (state.activeFilters) {
			this.filterStatus = { ...this.filterStatus, ...state.activeFilters };
		}
	}

	/** Sends current filter state to Lavalink. Call after restoreState() to apply. */
	public async applyFilters(): Promise<this> {
		return this.updateFilters();
	}
}

/** Options for adjusting the timescale of audio. */
interface TimescaleOptions {
	speed?: number;
	pitch?: number;
	rate?: number;
}

/** Options for applying vibrato effect to audio. */
interface VibratoOptions {
	frequency: number;
	depth: number;
}

/** Options for applying rotation effect to audio. */
interface RotationOptions {
	rotationHz: number;
}

/** Options for applying karaoke effect to audio. */
interface KaraokeOptions {
	level?: number;
	monoLevel?: number;
	filterBand?: number;
	filterWidth?: number;
}

interface DistortionOptions {
	sinOffset?: number;
	sinScale?: number;
	cosOffset?: number;
	cosScale?: number;
	tanOffset?: number;
	tanScale?: number;
	offset?: number;
	scale?: number;
}

interface AvailableFilters {
	bassboost: boolean;
	distort: boolean;
	eightD: boolean;
	karaoke: boolean;
	nightcore: boolean;
	slowmo: boolean;
	soft: boolean;
	trebleBass: boolean;
	tv: boolean;
	vaporwave: boolean;
}

export {
	Filters,
	TimescaleOptions,
	VibratoOptions,
	RotationOptions,
	KaraokeOptions,
	DistortionOptions,
	AvailableFilters,
};
