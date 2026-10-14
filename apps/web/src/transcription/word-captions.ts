import type { CaptionChunk } from "./types";

export interface TimedWord {
	word: string;
	/** Seconds. */
	start: number;
	/** Seconds. */
	end: number;
}

/** A pause longer than this always starts a new caption. */
const PAUSE_BREAK_SECONDS = 0.45;
/** How long a caption lingers after its last word when nothing follows. */
const HOLD_AFTER_SECONDS = 0.35;
/** Gaps shorter than this are closed so captions don't flicker. */
const SEAMLESS_GAP_SECONDS = 0.25;

const SENTENCE_END = /[.?!…]["')\]]*$/;
const CLAUSE_END = /[,;:]["')\]]*$/;

/** Drops trailing commas/periods the way short-form captions do; keeps ? and !. */
function displayWord({ word }: { word: string }): string {
	return word.replace(/[.,;:]+(["')\]]*)$/, "$1");
}

/**
 * Groups words into short captions timed to when each word is spoken.
 * A caption never spans a pause or a sentence/clause boundary.
 */
export function buildWordCaptions({
	words,
	wordsPerCaption,
	maxSeconds,
}: {
	words: TimedWord[];
	wordsPerCaption: number;
	maxSeconds: number;
}): CaptionChunk[] {
	const groups: TimedWord[][] = [];
	let current: TimedWord[] = [];

	for (const word of words) {
		const previous = current[current.length - 1];
		const startsNewGroup =
			current.length >= wordsPerCaption ||
			(previous &&
				(word.start - previous.end > PAUSE_BREAK_SECONDS ||
					SENTENCE_END.test(previous.word) ||
					CLAUSE_END.test(previous.word)));
		if (startsNewGroup && current.length > 0) {
			groups.push(current);
			current = [];
		}
		current.push(word);
	}
	if (current.length > 0) groups.push(current);

	const captions: CaptionChunk[] = [];
	groups.forEach((group, index) => {
		const startTime = group[0].start;
		if (startTime >= maxSeconds) return;

		const lastWordEnd = group[group.length - 1].end;
		const nextStart = groups[index + 1]?.[0].start ?? Number.POSITIVE_INFINITY;
		let endTime = Math.min(lastWordEnd + HOLD_AFTER_SECONDS, nextStart);
		if (nextStart - lastWordEnd < SEAMLESS_GAP_SECONDS) {
			endTime = nextStart;
		}
		endTime = Math.min(endTime, maxSeconds);

		captions.push({
			text: group.map((word) => displayWord({ word: word.word })).join(" "),
			startTime,
			duration: Math.max(endTime - startTime, 0.05),
		});
	});

	return captions;
}
