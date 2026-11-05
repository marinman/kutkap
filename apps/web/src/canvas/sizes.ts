import type { TCanvasSize } from "@/project/types";

export interface CanvasRatioPreset {
	id: string;
	label: string;
	/** Width:height, used to draw the preview shape. */
	ratio: number;
	canvasSize: TCanvasSize;
}

/** CapCut-style ratio menu: landscape group, then portrait/square group. Short side is 1080px. */
export const CANVAS_RATIO_PRESET_GROUPS: CanvasRatioPreset[][] = [
	[
		{ id: "16:9", label: "16:9", ratio: 16 / 9, canvasSize: { width: 1920, height: 1080 } },
		{ id: "4:3", label: "4:3", ratio: 4 / 3, canvasSize: { width: 1440, height: 1080 } },
		{ id: "2.35:1", label: "2.35:1", ratio: 2.35, canvasSize: { width: 2538, height: 1080 } },
		{ id: "2:1", label: "2:1", ratio: 2, canvasSize: { width: 2160, height: 1080 } },
		{ id: "1.85:1", label: "1.85:1", ratio: 1.85, canvasSize: { width: 1998, height: 1080 } },
	],
	[
		{ id: "9:16", label: "9:16", ratio: 9 / 16, canvasSize: { width: 1080, height: 1920 } },
		{ id: "3:4", label: "3:4", ratio: 3 / 4, canvasSize: { width: 1080, height: 1440 } },
		// Full-screen phone (iPhone X class, 1125x2436).
		{ id: "5.8-inch", label: "5.8-inch", ratio: 1125 / 2436, canvasSize: { width: 1080, height: 2340 } },
		{ id: "1:1", label: "1:1", ratio: 1, canvasSize: { width: 1080, height: 1080 } },
	],
];

export const CANVAS_RATIO_PRESETS: CanvasRatioPreset[] =
	CANVAS_RATIO_PRESET_GROUPS.flat();

export const DEFAULT_CANVAS_PRESETS: TCanvasSize[] = CANVAS_RATIO_PRESETS.map(
	(preset) => preset.canvasSize,
);

export const DEFAULT_CANVAS_SIZE: TCanvasSize = { width: 1920, height: 1080 };

export function areCanvasSizesEqual({
	left,
	right,
}: {
	left: TCanvasSize;
	right: TCanvasSize;
}): boolean {
	return left.width === right.width && left.height === right.height;
}
