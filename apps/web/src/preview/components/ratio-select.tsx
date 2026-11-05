import { Fragment } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
} from "@/components/ui/select";
import { AspectRatioShape } from "@/canvas/components/aspect-ratio-shape";
import {
	areCanvasSizesEqual,
	CANVAS_RATIO_PRESET_GROUPS,
	CANVAS_RATIO_PRESETS,
} from "@/canvas/sizes";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { useEditor } from "@/editor/use-editor";

const ORIGINAL = "original";
const CUSTOM = "custom";

/** CapCut-style canvas ratio switcher shown under the preview. */
export function RatioSelect() {
	const editor = useEditor();
	const settings = useEditor((e) => e.project.getActive().settings);
	const setActiveTab = useAssetsPanelStore((state) => state.setActiveTab);
	const { canvasSize, originalCanvasSize } = settings;
	const mode = settings.canvasSizeMode ?? "preset";

	const matchingPreset = CANVAS_RATIO_PRESETS.find((preset) =>
		areCanvasSizesEqual({ left: preset.canvasSize, right: canvasSize }),
	);
	const isOriginal =
		!!originalCanvasSize &&
		areCanvasSizesEqual({ left: originalCanvasSize, right: canvasSize });

	const value =
		mode === "custom"
			? CUSTOM
			: isOriginal
				? ORIGINAL
				: (matchingPreset?.id ?? CUSTOM);
	const triggerLabel =
		value === ORIGINAL ? "Original" : value === CUSTOM ? "Custom" : value;

	const onValueChange = (next: string) => {
		if (next === CUSTOM) {
			// Width and height fields live in the Settings panel.
			editor.project.updateSettings({
				settings: {
					canvasSizeMode: "custom",
					canvasSize: settings.lastCustomCanvasSize ?? canvasSize,
				},
			});
			setActiveTab("settings");
			return;
		}
		const nextSize =
			next === ORIGINAL
				? originalCanvasSize
				: CANVAS_RATIO_PRESETS.find((preset) => preset.id === next)
						?.canvasSize;
		if (!nextSize) return;
		editor.project.updateSettings({
			settings: { canvasSize: nextSize, canvasSizeMode: "preset" },
		});
	};

	return (
		<Select value={value} onValueChange={onValueChange}>
			<SelectTrigger aria-label="Canvas ratio" className="tabular-nums">
				{triggerLabel}
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={ORIGINAL} disabled={!originalCanvasSize}>
					Original
				</SelectItem>
				<SelectItem value={CUSTOM}>Custom</SelectItem>
				{CANVAS_RATIO_PRESET_GROUPS.map((group) => (
					<Fragment key={group[0].id}>
						<SelectSeparator />
						{group.map((preset) => (
							<SelectItem key={preset.id} value={preset.id}>
								<span className="flex w-28 items-center justify-between gap-3">
									{preset.label}
									<AspectRatioShape ratio={preset.ratio} />
								</span>
							</SelectItem>
						))}
					</Fragment>
				))}
			</SelectContent>
		</Select>
	);
}
