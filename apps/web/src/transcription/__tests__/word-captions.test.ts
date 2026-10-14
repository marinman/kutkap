import { describe, expect, test } from "bun:test";
import { buildWordCaptions, type TimedWord } from "@/transcription/word-captions";

const words: TimedWord[] = [
	{ word: "So", start: 0, end: 0.3 },
	{ word: "here's", start: 0.3, end: 0.62 },
	{ word: "the", start: 0.62, end: 0.74 },
	{ word: "thing,", start: 0.74, end: 0.98 },
	{ word: "most", start: 1.42, end: 1.58 },
	{ word: "people", start: 1.58, end: 1.9 },
	{ word: "edit.", start: 1.9, end: 2.22 },
	{ word: "Wow!", start: 3.5, end: 3.8 },
];

describe("buildWordCaptions", () => {
	test("each caption starts exactly when its first word is spoken", () => {
		const captions = buildWordCaptions({ words, wordsPerCaption: 2, maxSeconds: 10 });
		expect(captions.map((c) => c.text)).toEqual([
			"So here's",
			"the thing",
			"most people",
			"edit",
			"Wow!",
		]);
		expect(captions.map((c) => c.startTime)).toEqual([0, 0.62, 1.42, 1.9, 3.5]);
	});

	test("captions never overlap and close tiny gaps", () => {
		const captions = buildWordCaptions({ words, wordsPerCaption: 2, maxSeconds: 10 });
		for (let i = 0; i < captions.length - 1; i++) {
			const end = captions[i].startTime + captions[i].duration;
			expect(end).toBeLessThanOrEqual(captions[i + 1].startTime + 1e-9);
		}
		// "So here's" ends at 0.62 exactly where "the thing" begins.
		expect(captions[0].startTime + captions[0].duration).toBeCloseTo(0.62);
	});

	test("does not linger through a pause", () => {
		const captions = buildWordCaptions({ words, wordsPerCaption: 2, maxSeconds: 10 });
		const edit = captions[3];
		expect(edit.startTime + edit.duration).toBeCloseTo(2.22 + 0.35);
	});

	test("one word at a time", () => {
		const captions = buildWordCaptions({ words, wordsPerCaption: 1, maxSeconds: 10 });
		expect(captions).toHaveLength(words.length);
	});

	test("clamps to the timeline length", () => {
		const captions = buildWordCaptions({ words, wordsPerCaption: 2, maxSeconds: 3.6 });
		const last = captions[captions.length - 1];
		expect(last.text).toBe("Wow!");
		expect(last.startTime + last.duration).toBeCloseTo(3.6);
	});
});
