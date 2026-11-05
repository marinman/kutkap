import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/utils/ui";
import { serviceFileUrl } from "@/templates/api";
import {
	captureMediaFromUrl,
	type CaptureFormat,
} from "@/services/media-capture";

type CaptureState =
	| { status: "idle"; error: string | null }
	| { status: "working"; progress: number; message: string };

const MIME_TYPES: Record<CaptureFormat, string> = {
	mp4: "video/mp4",
	mp3: "audio/mpeg",
};

/** Paste a link, pick MP4 or MP3, and the file lands in the project's media. */
export function UrlCapture({
	onFile,
}: {
	onFile: (file: File) => Promise<void>;
}) {
	const [url, setUrl] = useState("");
	const [format, setFormat] = useState<CaptureFormat>("mp4");
	const [state, setState] = useState<CaptureState>({
		status: "idle",
		error: null,
	});
	const isWorking = state.status === "working";

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!url.trim() || isWorking) return;
		setState({ status: "working", progress: 0, message: "Starting…" });
		try {
			const result = await captureMediaFromUrl({
				url,
				format,
				onProgress: ({ progress, message }) =>
					setState({ status: "working", progress, message }),
			});
			setState({ status: "working", progress: 100, message: "Importing…" });
			const response = await fetch(serviceFileUrl({ path: result.file }));
			if (!response.ok) throw new Error("Couldn't load the downloaded file");
			const blob = await response.blob();
			await onFile(
				new File([blob], result.filename, { type: MIME_TYPES[format] }),
			);
			setUrl("");
			setState({ status: "idle", error: null });
		} catch (error) {
			setState({
				status: "idle",
				error: error instanceof Error ? error.message : "Download failed",
			});
		}
	};

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-1.5 pb-3">
			<div className="relative">
				<HugeiconsIcon
					icon={Link01Icon}
					className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
				/>
				<Input
					type="url"
					value={url}
					onChange={(event) => setUrl(event.target.value)}
					placeholder="Paste a video link…"
					aria-label="Media link"
					disabled={isWorking}
					className="h-8 pl-7 text-xs"
				/>
			</div>
			<div className="flex items-center gap-1.5">
				<div
					role="group"
					aria-label="Download format"
					className="bg-accent flex shrink-0 rounded-md p-0.5"
				>
					{(["mp4", "mp3"] as const).map((option) => (
						<button
							key={option}
							type="button"
							aria-pressed={format === option}
							disabled={isWorking}
							onClick={() => setFormat(option)}
							className={cn(
								"rounded px-1.5 py-1 text-[11px] font-medium uppercase",
								format === option
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground",
							)}
						>
							{option}
						</button>
					))}
				</div>
				<Button
					type="submit"
					size="sm"
					className="h-7 flex-1"
					disabled={!url.trim() || isWorking}
				>
					{isWorking ? "Downloading…" : `Get ${format.toUpperCase()}`}
				</Button>
			</div>
			{state.status === "working" && (
				<div className="flex flex-col gap-1">
					<Progress value={state.progress} className="h-1" />
					<span className="text-muted-foreground truncate text-[11px]">
						{state.message}
					</span>
				</div>
			)}
			{state.status === "idle" && state.error && (
				<p className="text-destructive text-[11px]">{state.error}</p>
			)}
		</form>
	);
}
