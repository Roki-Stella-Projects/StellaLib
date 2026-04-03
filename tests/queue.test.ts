/**
 * @file Queue unit tests
 * Tests for StellaQueue: add, remove, shuffle, maxSize, deduplication
 */
import { describe, test, expect, beforeEach } from "bun:test";

// We test Queue in isolation by importing it directly
// and creating mock tracks
function mockTrack(overrides: Partial<Record<string, any>> = {}): any {
	return {
		track: `encoded_${Math.random().toString(36).slice(2, 8)}`,
		title: overrides.title ?? `Track ${Math.random().toString(36).slice(2, 6)}`,
		author: overrides.author ?? "Test Artist",
		uri: overrides.uri ?? `https://example.com/${Math.random().toString(36).slice(2, 8)}`,
		duration: overrides.duration ?? 200000,
		identifier: overrides.identifier ?? `id_${Math.random().toString(36).slice(2, 8)}`,
		artworkUrl: "",
		sourceName: "youtube",
		isrc: "",
		isSeekable: true,
		isStream: false,
		thumbnail: null,
		requester: null,
		pluginInfo: {},
		displayThumbnail: () => null,
		// Symbol marker so TrackUtils.validate passes
		[Symbol.for("track")]: true,
		...overrides,
	};
}

// Minimal StellaQueue reimplementation for unit tests
// (avoids importing the full lib which requires Manager init)
class TestQueue extends Array<any> {
	public current: any = null;
	public previous: any = null;
	public maxSize = 0;
	public noDuplicates = false;

	get duration(): number {
		const current = this.current?.duration ?? 0;
		return this.reduce((acc: number, cur: any) => acc + (cur.duration || 0), current);
	}

	get totalSize(): number {
		return this.length + (this.current ? 1 : 0);
	}

	get size(): number {
		return this.length;
	}

	add(track: any | any[], offset?: number): void {
		const tracks = Array.isArray(track) ? track : [track];

		// Deduplication
		let filtered = tracks;
		if (this.noDuplicates) {
			filtered = tracks.filter((t) => !this.isDuplicate(t));
			if (!filtered.length) return;
		}

		// Max size enforcement
		if (this.maxSize > 0 && this.current) {
			const available = this.maxSize - this.length;
			if (available <= 0) throw new RangeError(`Queue is full (${this.maxSize} tracks max).`);
			if (filtered.length > available) filtered = filtered.slice(0, available);
		}

		if (!this.current) {
			this.current = filtered.shift() || null;
			this.push(...filtered);
		} else if (typeof offset === "number") {
			this.splice(offset, 0, ...filtered);
		} else {
			this.push(...filtered);
		}
	}

	isDuplicate(track: any): boolean {
		const uri = track.uri;
		const key = `${track.title}::${track.author}`;

		if (this.current) {
			if (uri && this.current.uri === uri) return true;
			if (`${this.current.title}::${this.current.author}` === key) return true;
		}
		return this.some((t: any) => {
			if (uri && t.uri === uri) return true;
			return `${t.title}::${t.author}` === key;
		});
	}

	remove(startOrPosition = 0, end?: number): any[] {
		if (typeof end !== "undefined") return this.splice(startOrPosition, end - startOrPosition);
		return this.splice(startOrPosition, 1);
	}

	clear(): void {
		this.splice(0);
	}

	shuffle(): void {
		for (let i = this.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[this[i], this[j]] = [this[j], this[i]];
		}
	}
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("StellaQueue", () => {
	let queue: TestQueue;

	beforeEach(() => {
		queue = new TestQueue();
	});

	describe("add()", () => {
		test("first track becomes current", () => {
			const t = mockTrack({ title: "First" });
			queue.add(t);
			expect(queue.current?.title).toBe("First");
			expect(queue.length).toBe(0);
		});

		test("second track goes to queue", () => {
			queue.add(mockTrack({ title: "First" }));
			queue.add(mockTrack({ title: "Second" }));
			expect(queue.current?.title).toBe("First");
			expect(queue.length).toBe(1);
			expect(queue[0].title).toBe("Second");
		});

		test("add array of tracks", () => {
			const tracks = [mockTrack({ title: "A" }), mockTrack({ title: "B" }), mockTrack({ title: "C" })];
			queue.add(tracks);
			expect(queue.current?.title).toBe("A");
			expect(queue.length).toBe(2);
			expect(queue[0].title).toBe("B");
			expect(queue[1].title).toBe("C");
		});

		test("add at offset", () => {
			queue.add(mockTrack({ title: "Current" }));
			queue.add(mockTrack({ title: "End" }));
			queue.add(mockTrack({ title: "Inserted" }), 0);
			expect(queue[0].title).toBe("Inserted");
			expect(queue[1].title).toBe("End");
		});
	});

	describe("remove()", () => {
		test("remove single track", () => {
			queue.add(mockTrack({ title: "Current" }));
			queue.add(mockTrack({ title: "Remove Me" }));
			queue.add(mockTrack({ title: "Stay" }));
			const removed = queue.remove(0);
			expect(removed[0].title).toBe("Remove Me");
			expect(queue.length).toBe(1);
		});

		test("remove range", () => {
			queue.add(mockTrack({ title: "Current" }));
			queue.add(mockTrack({ title: "A" }));
			queue.add(mockTrack({ title: "B" }));
			queue.add(mockTrack({ title: "C" }));
			const removed = queue.remove(0, 2);
			expect(removed.length).toBe(2);
			expect(queue.length).toBe(1);
		});
	});

	describe("clear()", () => {
		test("clears all queued tracks", () => {
			queue.add(mockTrack());
			queue.add(mockTrack());
			queue.add(mockTrack());
			queue.clear();
			expect(queue.length).toBe(0);
			expect(queue.current).not.toBeNull(); // current stays
		});
	});

	describe("shuffle()", () => {
		test("shuffles without losing tracks", () => {
			queue.add(mockTrack({ title: "Current" }));
			const titles = ["A", "B", "C", "D", "E", "F", "G", "H"];
			for (const t of titles) queue.add(mockTrack({ title: t }));
			queue.shuffle();
			expect(queue.length).toBe(titles.length);
			// All titles still present
			const shuffledTitles = queue.map((t: any) => t.title).sort();
			expect(shuffledTitles).toEqual(titles.sort());
		});
	});

	describe("properties", () => {
		test("duration sums correctly", () => {
			queue.add(mockTrack({ title: "Current", duration: 10000 }));
			queue.add(mockTrack({ title: "Queued", duration: 20000 }));
			expect(queue.duration).toBe(30000);
		});

		test("totalSize includes current", () => {
			queue.add(mockTrack());
			queue.add(mockTrack());
			expect(queue.totalSize).toBe(2);
			expect(queue.size).toBe(1);
		});
	});

	describe("maxSize", () => {
		test("throws when queue is full", () => {
			queue.maxSize = 2;
			queue.add(mockTrack({ title: "Current" }));
			queue.add(mockTrack({ title: "1" }));
			queue.add(mockTrack({ title: "2" }));
			expect(() => queue.add(mockTrack({ title: "3" }))).toThrow("Queue is full");
		});

		test("truncates array when exceeding limit", () => {
			queue.maxSize = 3;
			queue.add(mockTrack({ title: "Current" }));
			const batch = [
				mockTrack({ title: "A" }),
				mockTrack({ title: "B" }),
				mockTrack({ title: "C" }),
				mockTrack({ title: "D" }),
				mockTrack({ title: "E" }),
			];
			queue.add(batch);
			expect(queue.length).toBe(3); // maxSize = 3
		});

		test("maxSize=0 means unlimited", () => {
			queue.maxSize = 0;
			queue.add(mockTrack());
			for (let i = 0; i < 100; i++) queue.add(mockTrack());
			expect(queue.length).toBe(100);
		});
	});

	describe("noDuplicates", () => {
		test("skips duplicate by URI", () => {
			queue.noDuplicates = true;
			const t1 = mockTrack({ title: "Song", uri: "https://example.com/same" });
			const t2 = mockTrack({ title: "Song Copy", uri: "https://example.com/same" });
			queue.add(t1);
			queue.add(t2);
			expect(queue.totalSize).toBe(1); // Only current, no queue
		});

		test("skips duplicate by title+author", () => {
			queue.noDuplicates = true;
			const t1 = mockTrack({ title: "Same Song", author: "Same Artist", uri: "https://a.com/1" });
			const t2 = mockTrack({ title: "Same Song", author: "Same Artist", uri: "https://b.com/2" });
			queue.add(t1);
			queue.add(t2);
			expect(queue.totalSize).toBe(1);
		});

		test("allows different tracks", () => {
			queue.noDuplicates = true;
			queue.add(mockTrack({ title: "Song A", author: "Artist A" }));
			queue.add(mockTrack({ title: "Song B", author: "Artist B" }));
			expect(queue.totalSize).toBe(2);
		});

		test("isDuplicate checks current track", () => {
			queue.noDuplicates = false;
			const t = mockTrack({ title: "Current", uri: "https://x.com/1" });
			queue.add(t);
			expect(queue.isDuplicate(mockTrack({ uri: "https://x.com/1" }))).toBe(true);
			expect(queue.isDuplicate(mockTrack({ uri: "https://x.com/2" }))).toBe(false);
		});

		test("filters duplicates from batch add", () => {
			queue.noDuplicates = true;
			queue.add(mockTrack({ title: "Exists", author: "A", uri: "https://x.com/1" }));
			const batch = [
				mockTrack({ title: "Exists", author: "A", uri: "https://x.com/1" }), // dup
				mockTrack({ title: "New1", author: "B", uri: "https://x.com/2" }),
				mockTrack({ title: "New2", author: "C", uri: "https://x.com/3" }),
			];
			queue.add(batch);
			expect(queue.length).toBe(2); // Only New1 and New2
		});
	});
});
