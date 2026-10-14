/** Library summary returned by the reel-templates service (GET /api/templates). */
export interface ReelTemplateSummary {
	id: string;
	title: string;
	created_at: string;
	hook_type: string;
	format: {
		duration_s: number;
		aspect_ratio: string;
		resolution: string;
		fps: number;
	};
	pacing: {
		shots: number;
		cuts_per_min: number;
		avg_shot_s: number;
	};
	audio_type: "voice" | "music" | "both";
	/** Path relative to the service's /files mount, or null if the reel had no audio. */
	soundtrack_file: string | null;
	keyframes: (string | null)[];
	shots: { n: number; start: number; duration: number; role: string }[];
}
