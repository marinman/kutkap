import { create } from "zustand";
import { toast } from "sonner";
import type { EditorCore } from "@/core";
import { processMediaAssets } from "@/media/processing";
import { serviceFileUrl } from "@/templates/api";
import {
	cancelFaceSwap,
	startFaceSwap,
	waitForFaceSwap,
	type FaceSwapMode,
} from "./api";

type FaceSwapRun =
	| { status: "idle"; error: string | null }
	| { status: "running"; jobId: string | null; progress: number; message: string };

interface FaceSwapStore {
	run: FaceSwapRun;
	start: (params: {
		editor: EditorCore;
		source: File;
		target: File;
		mode: FaceSwapMode;
		enhance: boolean;
	}) => Promise<void>;
	cancel: () => Promise<void>;
}

/**
 * Lives outside the panel so a long swap keeps reporting progress
 * when the user switches tabs.
 */
export const useFaceSwapStore = create<FaceSwapStore>()((set, get) => ({
	run: { status: "idle", error: null },

	start: async ({ editor, source, target, mode, enhance }) => {
		const projectId = editor.project.getActive().metadata.id;
		set({
			run: { status: "running", jobId: null, progress: 0, message: "Uploading…" },
		});
		try {
			const jobId = await startFaceSwap({ source, target, mode, enhance });
			set({
				run: { status: "running", jobId, progress: 0, message: "Starting…" },
			});
			const result = await waitForFaceSwap({
				jobId,
				onProgress: ({ progress, message }) =>
					set({ run: { status: "running", jobId, progress, message } }),
			});

			const response = await fetch(serviceFileUrl({ path: result.file }));
			if (!response.ok) throw new Error("Couldn't load the face swap result");
			const blob = await response.blob();
			const file = new File([blob], result.filename, {
				type: target.type || blob.type,
			});
			const [asset] = await processMediaAssets({ files: [file] });
			if (!asset) throw new Error("Couldn't import the face swap result");
			await editor.media.addMediaAsset({ projectId, asset });

			toast.success("Face swap finished", {
				description: `${result.filename} was added to Media.`,
			});
			set({ run: { status: "idle", error: null } });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Face swap failed";
			set({ run: { status: "idle", error: message } });
		}
	},

	cancel: async () => {
		const { run } = get();
		if (run.status === "running" && run.jobId) {
			await cancelFaceSwap({ jobId: run.jobId });
		}
	},
}));
