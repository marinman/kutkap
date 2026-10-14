import type { TimedWord } from "@/transcription/word-captions";

/** Kutkap's local Python service (apps/reel-templates), started by the launcher. */
export const LOCAL_SERVICE_URL = "http://localhost:3518";

export async function isLocalServiceAvailable(): Promise<boolean> {
	try {
		const response = await fetch(`${LOCAL_SERVICE_URL}/api/health`, {
			signal: AbortSignal.timeout(1500),
		});
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Transcribes with faster-whisper on this machine. Returns per-word
 * timestamps, which are far more precise than the in-browser segment timings.
 */
export async function transcribeWithLocalService({
	audioBlob,
	language,
}: {
	audioBlob: Blob;
	language?: string;
}): Promise<TimedWord[]> {
	const query = language ? `?language=${encodeURIComponent(language)}` : "";
	const response = await fetch(`${LOCAL_SERVICE_URL}/api/transcribe${query}`, {
		method: "POST",
		headers: { "Content-Type": "application/octet-stream" },
		body: audioBlob,
	});
	if (!response.ok) {
		throw new Error("The local transcription service failed");
	}
	const data: { words: TimedWord[] } = await response.json();
	return data.words;
}
