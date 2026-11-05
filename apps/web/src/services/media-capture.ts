import { LOCAL_SERVICE_URL } from "@/services/transcription/local-service";

export type CaptureFormat = "mp4" | "mp3";

interface CaptureJob {
	status: "running" | "done" | "error";
	progress: number;
	message: string;
	error: string | null;
	result: { file: string; filename: string; title: string } | null;
}

const POLL_INTERVAL_MS = 600;

async function readError({ response }: { response: Response }): Promise<string> {
	try {
		const data = await response.json();
		return data.detail?.message ?? "Download failed";
	} catch {
		return "Download failed";
	}
}

/**
 * Downloads a link (YouTube, Instagram, TikTok, direct media files, …) as MP4
 * or MP3 through Kutkap's local service, which uses yt-dlp and ffmpeg.
 */
export async function captureMediaFromUrl({
	url,
	format,
	onProgress,
}: {
	url: string;
	format: CaptureFormat;
	onProgress?: (update: { progress: number; message: string }) => void;
}): Promise<NonNullable<CaptureJob["result"]>> {
	let response: Response;
	try {
		response = await fetch(`${LOCAL_SERVICE_URL}/api/capture`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: url.trim(), format }),
		});
	} catch {
		throw new Error(
			"Kutkap's download service isn't running. Open Kutkap from its app icon.",
		);
	}
	if (!response.ok) throw new Error(await readError({ response }));
	const { job_id: jobId } = (await response.json()) as { job_id: string };

	for (;;) {
		const jobResponse = await fetch(`${LOCAL_SERVICE_URL}/api/jobs/${jobId}`);
		if (!jobResponse.ok) throw new Error(await readError({ response: jobResponse }));
		const job = (await jobResponse.json()) as CaptureJob;
		onProgress?.({ progress: job.progress, message: job.message });
		if (job.status === "done" && job.result) return job.result;
		if (job.status === "error") throw new Error(job.error ?? "Download failed");
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
}
