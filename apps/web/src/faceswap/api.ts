import { LOCAL_SERVICE_URL } from "@/services/transcription/local-service";

export type FaceSwapMode = "main" | "everyone";

export interface FaceSwapStatus {
	available: boolean;
	busy: boolean;
	ui_url: string;
}

interface Job {
	status: "running" | "done" | "error";
	progress: number;
	message: string;
	error: string | null;
	result: { file: string; filename: string } | null;
}

async function readError({ response }: { response: Response }): Promise<string> {
	try {
		const data = await response.json();
		return data.detail?.message ?? "Face swap failed";
	} catch {
		return "Face swap failed";
	}
}

export async function fetchFaceSwapStatus(): Promise<FaceSwapStatus | null> {
	try {
		const response = await fetch(`${LOCAL_SERVICE_URL}/api/faceswap/status`, {
			signal: AbortSignal.timeout(1500),
		});
		return response.ok ? response.json() : null;
	} catch {
		return null;
	}
}

export async function openFaceFusion(): Promise<void> {
	const response = await fetch(`${LOCAL_SERVICE_URL}/api/faceswap/open`, {
		method: "POST",
	});
	if (!response.ok) throw new Error(await readError({ response }));
}

export async function startFaceSwap({
	source,
	target,
	mode,
	enhance,
}: {
	source: File;
	target: File;
	mode: FaceSwapMode;
	enhance: boolean;
}): Promise<string> {
	const form = new FormData();
	form.append("source", source);
	form.append("target", target);
	form.append("mode", mode);
	form.append("enhance", String(enhance));
	const response = await fetch(`${LOCAL_SERVICE_URL}/api/faceswap`, {
		method: "POST",
		body: form,
	});
	if (!response.ok) throw new Error(await readError({ response }));
	const { job_id: jobId } = (await response.json()) as { job_id: string };
	return jobId;
}

export async function cancelFaceSwap({ jobId }: { jobId: string }): Promise<void> {
	await fetch(`${LOCAL_SERVICE_URL}/api/jobs/${jobId}/cancel`, { method: "POST" });
}

export async function waitForFaceSwap({
	jobId,
	onProgress,
}: {
	jobId: string;
	onProgress: (update: { progress: number; message: string }) => void;
}): Promise<NonNullable<Job["result"]>> {
	for (;;) {
		const response = await fetch(`${LOCAL_SERVICE_URL}/api/jobs/${jobId}`);
		if (!response.ok) throw new Error(await readError({ response }));
		const job = (await response.json()) as Job;
		onProgress({ progress: job.progress, message: job.message });
		if (job.status === "done" && job.result) return job.result;
		if (job.status === "error") throw new Error(job.error ?? "Face swap failed");
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}
