import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { useEditor } from "@/editor/use-editor";
import type { MediaAsset } from "@/media/types";
import { cn } from "@/utils/ui";
import {
	fetchFaceSwapStatus,
	openFaceFusion,
	type FaceSwapMode,
	type FaceSwapStatus,
} from "@/faceswap/api";
import { useFaceSwapStore } from "@/faceswap/faceswap-store";

const MODES: { value: FaceSwapMode; label: string }[] = [
	{ value: "main", label: "Main face" },
	{ value: "everyone", label: "Everyone" },
];

export function FaceSwapView() {
	const editor = useEditor();
	const assets = useEditor((e) => e.media.getAssets());
	const { run, start, cancel } = useFaceSwapStore();
	const [status, setStatus] = useState<FaceSwapStatus | null | "loading">(
		"loading",
	);
	const [uploadedFace, setUploadedFace] = useState<File | null>(null);
	const [faceId, setFaceId] = useState<string | null>(null);
	const [targetId, setTargetId] = useState<string | null>(null);
	const [mode, setMode] = useState<FaceSwapMode>("main");
	const [enhance, setEnhance] = useState(true);
	const faceInputRef = useRef<HTMLInputElement>(null);

	const [uploadedFaceUrl, setUploadedFaceUrl] = useState<string | null>(null);

	useEffect(() => {
		void fetchFaceSwapStatus().then(setStatus);
	}, []);

	useEffect(() => {
		if (!uploadedFace) {
			setUploadedFaceUrl(null);
			return;
		}
		const url = URL.createObjectURL(uploadedFace);
		setUploadedFaceUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [uploadedFace]);

	const images = assets.filter((asset) => asset.type === "image");
	const targets = assets.filter(
		(asset) => asset.type === "video" || asset.type === "image",
	);
	const faceFile =
		uploadedFace ?? images.find((asset) => asset.id === faceId)?.file ?? null;
	const target = targets.find((asset) => asset.id === targetId) ?? null;
	const isRunning = run.status === "running";

	const handleSwap = () => {
		if (!faceFile || !target) return;
		void start({ editor, source: faceFile, target: target.file, mode, enhance });
	};

	const handleOpenFaceFusion = async () => {
		try {
			await openFaceFusion();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Couldn't open FaceFusion");
		}
	};

	if (status === "loading") {
		return (
			<PanelView title="Face swap">
				<div className="flex justify-center p-6">
					<Spinner />
				</div>
			</PanelView>
		);
	}

	if (!status || !status.available) {
		return (
			<PanelView title="Face swap">
				<p className="text-muted-foreground p-1 text-sm">
					{status === null
						? "Kutkap's background service isn't running. Open Kutkap from its app icon."
						: "FaceFusion wasn't found in ~/facefusion. Install it there to use face swap."}
				</p>
			</PanelView>
		);
	}

	return (
		<PanelView title="Face swap">
			<input
				ref={faceInputRef}
				type="file"
				accept="image/jpeg,image/png,image/webp"
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0] ?? null;
					event.target.value = "";
					if (file) {
						setUploadedFace(file);
						setFaceId(null);
					}
				}}
			/>
			<div className="flex flex-col gap-4 pb-3">
				<section className="flex flex-col gap-2">
					<Label>1. New face</Label>
					<div className="grid grid-cols-3 gap-1.5">
						{uploadedFace && (
							<FaceTile
								label={uploadedFace.name}
								src={uploadedFaceUrl ?? undefined}
								isSelected
								onClick={() => undefined}
							/>
						)}
						{images.map((asset) => (
							<FaceTile
								key={asset.id}
								label={asset.name}
								src={asset.thumbnailUrl ?? asset.url}
								isSelected={!uploadedFace && faceId === asset.id}
								onClick={() => {
									setUploadedFace(null);
									setFaceId(asset.id);
								}}
							/>
						))}
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => faceInputRef.current?.click()}
						disabled={isRunning}
					>
						{images.length > 0 || uploadedFace ? "Use another photo…" : "Choose a face photo…"}
					</Button>
				</section>

				<section className="flex flex-col gap-2">
					<Label>2. Video or image to change</Label>
					{targets.length === 0 ? (
						<p className="text-muted-foreground text-xs">
							Import a video or image in Media first.
						</p>
					) : (
						<div className="flex flex-col gap-1">
							{targets.map((asset) => (
								<TargetRow
									key={asset.id}
									asset={asset}
									isSelected={targetId === asset.id}
									onClick={() => setTargetId(asset.id)}
								/>
							))}
						</div>
					)}
				</section>

				<section className="flex flex-col gap-2">
					<Label>3. Who to replace</Label>
					<div role="group" aria-label="Who to replace" className="bg-accent flex rounded-md p-0.5">
						{MODES.map((option) => (
							<button
								key={option.value}
								type="button"
								aria-pressed={mode === option.value}
								disabled={isRunning}
								onClick={() => setMode(option.value)}
								className={cn(
									"flex-1 rounded px-2 py-1 text-xs font-medium",
									mode === option.value
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground",
								)}
							>
								{option.label}
							</button>
						))}
					</div>
					<div className="flex items-center justify-between">
						<Label htmlFor="faceswap-enhance" className="text-muted-foreground text-xs font-normal">
							Sharpen the new face
						</Label>
						<Switch
							id="faceswap-enhance"
							checked={enhance}
							onCheckedChange={setEnhance}
							disabled={isRunning}
						/>
					</div>
				</section>

				{isRunning ? (
					<div className="flex flex-col gap-2">
						<Progress value={run.progress} className="h-1.5" />
						<p className="text-muted-foreground text-xs">{run.message}</p>
						<Button variant="outline" size="sm" onClick={() => void cancel()}>
							Cancel
						</Button>
					</div>
				) : (
					<Button onClick={handleSwap} disabled={!faceFile || !target}>
						Swap faces
					</Button>
				)}
				{run.status === "idle" && run.error && (
					<p className="text-destructive text-xs">{run.error}</p>
				)}

				<p className="text-muted-foreground text-[11px] leading-snug">
					Runs on this Mac with your FaceFusion, about 1–2 seconds per frame.
					Only use faces of people who've agreed to it.{" "}
					<button
						type="button"
						className="text-foreground underline underline-offset-2"
						onClick={() => void handleOpenFaceFusion()}
					>
						Open FaceFusion
					</button>{" "}
					to pick one specific person in a group.
				</p>
			</div>
		</PanelView>
	);
}

function FaceTile({
	label,
	src,
	isSelected,
	onClick,
}: {
	label: string;
	src?: string;
	isSelected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-pressed={isSelected}
			onClick={onClick}
			className={cn(
				"bg-accent aspect-square overflow-hidden rounded-md border-2",
				isSelected ? "border-primary" : "border-transparent",
			)}
		>
			{src && <img src={src} alt={label} className="size-full object-cover" />}
		</button>
	);
}

function TargetRow({
	asset,
	isSelected,
	onClick,
}: {
	asset: MediaAsset;
	isSelected: boolean;
	onClick: () => void;
}) {
	const preview = asset.thumbnailUrl ?? (asset.type === "image" ? asset.url : undefined);
	return (
		<button
			type="button"
			aria-pressed={isSelected}
			onClick={onClick}
			className={cn(
				"flex items-center gap-2 rounded-md border p-1 text-left text-xs",
				isSelected ? "border-primary bg-accent" : "border-transparent hover:bg-accent/50",
			)}
		>
			<div className="bg-accent h-8 w-12 shrink-0 overflow-hidden rounded">
				{preview && <img src={preview} alt="" className="size-full object-cover" />}
			</div>
			<span className="truncate">{asset.name}</span>
		</button>
	);
}
