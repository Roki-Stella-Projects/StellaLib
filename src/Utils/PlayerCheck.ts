/**
 * @license
 * StellaLib — Copyright (c) 2026 AntonyZ, x2sadddDM, SynX, Astel (OSL-3.0)
 * Derived from LithiumX — Copyright (c) 2025 Anantix Network (MIT)
 * See LICENSE and THIRD-PARTY-NOTICES.md for full license details.
 */
import type { PlayerOptions } from "../Structures/Types";

export default function PlayerCheck(options: PlayerOptions): void {
	if (!options) throw new TypeError("PlayerOptions must not be empty.");

	const { guild, node, selfDeafen, selfMute, textChannel, voiceChannel, volume } = options;

	if (!/^\d+$/.test(guild))
		throw new TypeError('Player option "guild" must be present and be a non-empty string.');
	if (node && typeof node !== "string")
		throw new TypeError('Player option "node" must be a non-empty string.');
	if (typeof selfDeafen !== "undefined" && typeof selfDeafen !== "boolean")
		throw new TypeError('Player option "selfDeafen" must be a boolean.');
	if (typeof selfMute !== "undefined" && typeof selfMute !== "boolean")
		throw new TypeError('Player option "selfMute" must be a boolean.');
	if (textChannel && !/^\d+$/.test(textChannel))
		throw new TypeError('Player option "textChannel" must be a non-empty string.');
	if (voiceChannel && !/^\d+$/.test(voiceChannel))
		throw new TypeError('Player option "voiceChannel" must be a non-empty string.');
	if (typeof volume !== "undefined" && typeof volume !== "number")
		throw new TypeError('Player option "volume" must be a number.');
}
