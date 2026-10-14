import { LOCAL_SERVICE_URL } from "@/services/transcription/local-service";
import type { ReelTemplateSummary } from "./types";

export const REEL_TEMPLATES_APP_URL = LOCAL_SERVICE_URL;

export function serviceFileUrl({ path }: { path: string }): string {
	return `${LOCAL_SERVICE_URL}/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function fetchReelTemplates({
	query = "",
}: {
	query?: string;
} = {}): Promise<ReelTemplateSummary[]> {
	const response = await fetch(
		`${LOCAL_SERVICE_URL}/api/templates?q=${encodeURIComponent(query)}`,
	);
	if (!response.ok) {
		throw new Error("Couldn't load templates");
	}
	return response.json();
}

export async function fetchSoundtrack({
	template,
}: {
	template: ReelTemplateSummary;
}): Promise<File | null> {
	if (!template.soundtrack_file) return null;
	const response = await fetch(serviceFileUrl({ path: template.soundtrack_file }));
	if (!response.ok) return null;
	const blob = await response.blob();
	return new File([blob], `${template.title.slice(0, 40)} (soundtrack).m4a`, {
		type: "audio/mp4",
	});
}
