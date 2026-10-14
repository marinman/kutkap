import type { SubtitleCue, SubtitleStyleOverrides } from "./types";

export interface CaptionPreset {
	id: string;
	label: string;
	style: SubtitleStyleOverrides;
	uppercase?: boolean;
	/** Preview swatch colors for the picker. */
	preview: { text: string; background?: string };
}

export const CAPTION_PRESETS: CaptionPreset[] = [
	{
		id: "classic",
		label: "Classic",
		style: {},
		preview: { text: "#ffffff" },
	},
	{
		id: "bold-pop",
		label: "Bold Pop",
		uppercase: true,
		style: {
			fontFamily: "Montserrat",
			fontWeight: "bold",
			fontSize: 7,
			color: "#ffe14d",
			placement: { verticalAlign: "middle" },
		},
		preview: { text: "#ffe14d" },
	},
	{
		id: "boxed",
		label: "Boxed",
		style: {
			fontFamily: "Inter",
			fontWeight: "bold",
			color: "#ffffff",
			background: {
				enabled: true,
				color: "rgba(0, 0, 0, 0.75)",
				cornerRadius: 12,
				paddingX: 24,
				paddingY: 16,
			},
			placement: { marginVerticalRatio: 0.12 },
		},
		preview: { text: "#ffffff", background: "rgba(0, 0, 0, 0.75)" },
	},
	{
		id: "highlight",
		label: "Highlight",
		uppercase: true,
		style: {
			fontFamily: "Anton",
			fontWeight: "normal",
			fontSize: 6.5,
			color: "#111111",
			background: {
				enabled: true,
				color: "#ffe14d",
				cornerRadius: 8,
				paddingX: 20,
				paddingY: 10,
			},
			placement: { marginVerticalRatio: 0.18 },
		},
		preview: { text: "#111111", background: "#ffe14d" },
	},
	{
		id: "minimal",
		label: "Minimal",
		style: {
			fontFamily: "Inter",
			fontWeight: "normal",
			fontSize: 4,
			color: "#f5f5f5",
			placement: { marginVerticalRatio: 0.06 },
		},
		preview: { text: "#f5f5f5" },
	},
];

export const DEFAULT_CAPTION_PRESET_ID = "classic";

export const WORDS_PER_CAPTION_OPTIONS = [1, 2, 3, 5, 8] as const;

export function getCaptionPreset({ id }: { id: string }): CaptionPreset {
	return CAPTION_PRESETS.find((preset) => preset.id === id) ?? CAPTION_PRESETS[0];
}

/**
 * Applies a preset to cues. Cues that already carry their own style
 * (e.g. imported ASS files) keep it.
 */
export function applyCaptionPreset({
	captions,
	preset,
}: {
	captions: SubtitleCue[];
	preset: CaptionPreset;
}): SubtitleCue[] {
	return captions.map((caption) => {
		if (caption.style) return caption;
		return {
			...caption,
			text: preset.uppercase ? caption.text.toUpperCase() : caption.text,
			style: preset.style,
		};
	});
}

/**
 * Minimum caption durations can push the last captions past the end of the
 * media, which would lengthen the export. Trim or drop those captions.
 */
export function clampCaptionsToDuration({
	captions,
	maxSeconds,
}: {
	captions: SubtitleCue[];
	maxSeconds: number;
}): SubtitleCue[] {
	return captions
		.filter((caption) => caption.startTime < maxSeconds)
		.map((caption) => ({
			...caption,
			duration: Math.min(caption.duration, maxSeconds - caption.startTime),
		}));
}

export function getCaptionPresetFonts({
	preset,
}: {
	preset: CaptionPreset;
}): string[] {
	return preset.style.fontFamily ? [preset.style.fontFamily] : [];
}
