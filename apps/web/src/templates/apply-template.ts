import { BatchCommand, InsertElementCommand } from "@/commands";
import type { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import { processMediaAssets } from "@/media/processing";
import { buildElementFromMedia } from "@/timeline/element-utils";
import type { CreateTimelineElement } from "@/timeline";
import { mediaTimeFromSeconds, mediaTimeToSeconds, ZERO_MEDIA_TIME } from "@/wasm";
import { fetchSoundtrack } from "./api";
import type { ReelTemplateSummary } from "./types";

export interface ApplyTemplateResult {
	shotCount: number;
	shortClipCount: number;
	hasSoundtrack: boolean;
}

function parseResolution({
	resolution,
}: {
	resolution: string;
}): { width: number; height: number } | null {
	const match = resolution.match(/^(\d+)x(\d+)$/);
	return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

/** Media renders "contain"-fit by default; this scale makes it fill the frame like CapCut. */
function coverScale({
	asset,
	canvas,
}: {
	asset: MediaAsset;
	canvas: { width: number; height: number };
}): number {
	if (!asset.width || !asset.height) return 1;
	const contain = Math.min(canvas.width / asset.width, canvas.height / asset.height);
	const cover = Math.max(canvas.width / asset.width, canvas.height / asset.height);
	return cover / contain;
}

async function importFiles({
	editor,
	projectId,
	files,
}: {
	editor: EditorCore;
	projectId: string;
	files: File[];
}): Promise<MediaAsset[]> {
	const processed = await processMediaAssets({ files });
	const assets: MediaAsset[] = [];
	for (const asset of processed) {
		const added = await editor.media.addMediaAsset({ projectId, asset });
		if (added) assets.push(added);
	}
	return assets;
}

/**
 * Lays the user's clips into the template's shot timings (cycling through
 * clips if there are fewer clips than shots), fills the frame, and adds the
 * reel's soundtrack with the clips' own audio muted.
 */
export async function applyReelTemplate({
	editor,
	template,
	files,
}: {
	editor: EditorCore;
	template: ReelTemplateSummary;
	files: File[];
}): Promise<ApplyTemplateResult> {
	const project = editor.project.getActive();
	if (!project) throw new Error("No project is open");
	if (mediaTimeToSeconds({ time: editor.timeline.getTotalDuration() }) > 0) {
		throw new Error("Start from an empty project to use a template");
	}

	const visualFiles = files.filter(
		(file) => file.type.startsWith("video/") || file.type.startsWith("image/"),
	);
	if (visualFiles.length === 0) {
		throw new Error("Pick at least one video or photo");
	}

	const projectId = project.metadata.id;
	const clips = await importFiles({ editor, projectId, files: visualFiles });
	if (clips.length === 0) throw new Error("None of the files could be imported");

	const soundtrackFile = await fetchSoundtrack({ template });
	const [soundtrack] = soundtrackFile
		? await importFiles({ editor, projectId, files: [soundtrackFile] })
		: [];

	const canvas =
		parseResolution({ resolution: template.format.resolution }) ??
		project.settings.canvasSize;
	const mainTrackId = editor.scenes.getActiveScene().tracks.main.id;

	let shortClipCount = 0;
	const insertCommands = template.shots.map((shot, index) => {
		const asset = clips[index % clips.length];
		let seconds = shot.duration;
		if (asset.type === "video" && asset.duration != null && asset.duration < seconds) {
			seconds = asset.duration;
			shortClipCount++;
		}

		const element = buildElementFromMedia({
			mediaId: asset.id,
			mediaType: asset.type,
			name: `Shot ${shot.n}`,
			duration: mediaTimeFromSeconds({ seconds }),
			startTime: mediaTimeFromSeconds({ seconds: shot.start }),
		});
		const scale = coverScale({ asset, canvas });
		const filled = {
			...element,
			params: {
				...element.params,
				"transform.scaleX": scale,
				"transform.scaleY": scale,
			},
		} as CreateTimelineElement;

		if (filled.type === "video" && asset.duration != null) {
			filled.sourceDuration = mediaTimeFromSeconds({ seconds: asset.duration });
			filled.trimStart = ZERO_MEDIA_TIME;
			filled.trimEnd = mediaTimeFromSeconds({
				seconds: Math.max(0, asset.duration - seconds),
			});
			// The reel's soundtrack replaces the clips' own audio.
			filled.isSourceAudioEnabled = !soundtrack;
		}

		return new InsertElementCommand({
			element: filled,
			placement: { mode: "explicit", trackId: mainTrackId },
		});
	});

	if (soundtrack) {
		insertCommands.push(
			new InsertElementCommand({
				element: buildElementFromMedia({
					mediaId: soundtrack.id,
					mediaType: "audio",
					name: "Reel soundtrack",
					duration: mediaTimeFromSeconds({
						seconds: soundtrack.duration ?? template.format.duration_s,
					}),
					startTime: ZERO_MEDIA_TIME,
				}),
				placement: { mode: "auto", trackType: "audio" },
			}),
		);
	}

	editor.command.execute({ command: new BatchCommand(insertCommands) });

	// The first inserted clip resizes the canvas to its own size; the template's format wins.
	await editor.project.updateSettings({
		settings: { canvasSize: canvas },
		pushHistory: false,
	});

	return {
		shotCount: template.shots.length,
		shortClipCount,
		hasSoundtrack: Boolean(soundtrack),
	};
}
