import { HugeiconsIcon } from "@hugeicons/react";
import { UserSwitchIcon } from "@hugeicons/core-free-icons";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { useEditor } from "@/editor/use-editor";
import { useFaceSwapStore } from "@/faceswap/faceswap-store";
import { cn } from "@/utils/ui";

/**
 * Big header shortcut to the Face swap panel. If one video or image clip is
 * selected on the timeline, it becomes the swap target.
 */
export function SwapFaceButton() {
	const editor = useEditor();
	const setActiveTab = useAssetsPanelStore((state) => state.setActiveTab);
	const setPreferredTargetId = useFaceSwapStore(
		(state) => state.setPreferredTargetId,
	);
	const progress = useFaceSwapStore((state) =>
		state.run.status === "running" ? state.run.progress : null,
	);

	const handleClick = () => {
		const selected = editor.selection.getSelectedElements();
		if (selected.length === 1) {
			const [entry] = editor.timeline.getElementsWithTracks({
				elements: selected,
			});
			const element = entry?.element;
			if (element && (element.type === "video" || element.type === "image")) {
				setPreferredTargetId(element.mediaId);
			}
		}
		setActiveTab("faceswap");
	};

	return (
		<button
			type="button"
			onClick={handleClick}
			className={cn(
				"relative flex h-9 items-center gap-2 overflow-hidden rounded-lg px-4 text-sm font-semibold text-white",
				"bg-linear-to-r from-[#ff3d81] via-[#c13bff] to-[#6b5bff] shadow-[0_2px_10px_rgba(193,59,255,0.45)]",
				"transition-transform hover:scale-[1.03] active:scale-[0.98]",
			)}
		>
			{progress !== null && (
				<span
					aria-hidden
					className="absolute inset-y-0 left-0 bg-white/20 transition-[width]"
					style={{ width: `${progress}%` }}
				/>
			)}
			<HugeiconsIcon icon={UserSwitchIcon} className="relative size-4.5" />
			<span className="relative">
				{progress !== null ? `Swapping… ${Math.round(progress)}%` : "Swap face"}
			</span>
		</button>
	);
}
