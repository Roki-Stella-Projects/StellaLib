import { describe, test, expect } from "bun:test";
import {
	normalizeText,
	normalizeAuthor,
	getStyleProfile,
	getScriptProfile,
} from "../src/Structures/Node";

describe("Autoplay Helper Utilities", () => {
	describe("normalizeText()", () => {
		test("removes common promotional suffixes in parentheses/brackets", () => {
			expect(normalizeText("Shape of You (Official Music Video)")).toBe("shape of you");
			expect(normalizeText("Happier [Lyrics]")).toBe("happier");
			expect(normalizeText("Song Name (feat. Artist)")).toBe("song name");
			expect(normalizeText("Song Title (Official Lyric Video)")).toBe("song title");
			expect(normalizeText("Perfect [HD visualizer]")).toBe("perfect");
			expect(normalizeText("Acoustic Cover (live)")).toBe("acoustic cover");
		});

		test("removes standalone promotional keywords", () => {
			expect(normalizeText("Official Video: Starboy")).toBe("starboy");
			expect(normalizeText("Starboy feat. Daft Punk")).toBe("starboy");
		});

		test("cleans up special characters and consolidates whitespace", () => {
			expect(normalizeText("  Hello!!!   World???  ")).toBe("hello world");
			expect(normalizeText("Music - & - Vibe")).toBe("music vibe");
		});
	});

	describe("normalizeAuthor()", () => {
		test("removes topic/VEVO suffixes", () => {
			expect(normalizeAuthor("Ed Sheeran VEVO")).toBe("ed sheeran");
			expect(normalizeAuthor("Coldplay - Topic")).toBe("coldplay");
			expect(normalizeAuthor("Silo Music Channel")).toBe("silo");
		});
	});

	describe("getStyleProfile()", () => {
		test("detects style keywords in title", () => {
			const p1 = getStyleProfile("Lofi Hip Hop Radio");
			expect(p1.has("lofi")).toBe(true);

			const p2 = getStyleProfile("Ultimate Phonk Playlist 2026");
			expect(p2.has("phonk")).toBe(true);

			const p3 = getStyleProfile("Slowed & Reverb Compilation");
			expect(p3.has("slowed")).toBe(true);
			expect(p3.has("reverb")).toBe(true);

			const p4 = getStyleProfile("Sped up version of Perfect");
			expect(p4.has("speed up")).toBe(true);
		});
	});

	describe("getScriptProfile()", () => {
		test("detects CJK (Japanese/Chinese/Korean) character scripts", () => {
			const profile = getScriptProfile("夜に駆ける Yoasobi");
			expect(profile.hasCJK).toBe(true);
			expect(profile.hasCyrillic).toBe(false);
		});

		test("detects Cyrillic character scripts", () => {
			const profile = getScriptProfile("Группа Крови - Кино");
			expect(profile.hasCyrillic).toBe(true);
			expect(profile.hasCJK).toBe(false);
		});

		test("detects Thai character scripts", () => {
			const profile = getScriptProfile("รักแรก -นนท์ ธนนท์");
			expect(profile.hasThai).toBe(true);
			expect(profile.hasCJK).toBe(false);
		});

		test("detects Latin-only characters as not CJK/Cyrillic/Thai", () => {
			const profile = getScriptProfile("Blinding Lights - The Weeknd");
			expect(profile.hasCJK).toBe(false);
			expect(profile.hasCyrillic).toBe(false);
			expect(profile.hasThai).toBe(false);
		});
	});

	describe("Hi-Fi & Equalizer Presets", () => {
		test("crystalClearEqualizer bands are correct", () => {
			const { crystalClearEqualizer } = require("../src/Utils/FiltersEqualizers");
			expect(crystalClearEqualizer).toBeDefined();
			expect(crystalClearEqualizer.length).toBe(15);
			// Mud reduction bands
			expect(crystalClearEqualizer[5].band).toBe(5);
			expect(crystalClearEqualizer[5].gain).toBe(-0.1);
			// Brightness / treble
			expect(crystalClearEqualizer[11].band).toBe(11);
			expect(crystalClearEqualizer[11].gain).toBe(0.2);
		});
	});
});
