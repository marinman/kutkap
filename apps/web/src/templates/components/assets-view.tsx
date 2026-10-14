import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { LinkSquare02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { useEditor } from "@/editor/use-editor";
import { isLocalServiceAvailable } from "@/services/transcription/local-service";
import {
	REEL_TEMPLATES_APP_URL,
	fetchReelTemplates,
	serviceFileUrl,
} from "@/templates/api";
import { applyReelTemplate } from "@/templates/apply-template";
import type { ReelTemplateSummary } from "@/templates/types";

type LoadState =
	| { status: "loading" }
	| { status: "offline" }
	| { status: "ready"; templates: ReelTemplateSummary[] };

export function TemplatesView() {
	const editor = useEditor();
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const [applyingId, setApplyingId] = useState<string | null>(null);
	const pendingTemplate = useRef<ReelTemplateSummary | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const load = useCallback(async () => {
		setState({ status: "loading" });
		if (!(await isLocalServiceAvailable())) {
			setState({ status: "offline" });
			return;
		}
		try {
			setState({ status: "ready", templates: await fetchReelTemplates() });
		} catch {
			setState({ status: "offline" });
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const chooseClips = (template: ReelTemplateSummary) => {
		pendingTemplate.current = template;
		fileInputRef.current?.click();
	};

	const handleFiles = async (files: File[]) => {
		const template = pendingTemplate.current;
		if (!template || files.length === 0) return;
		setApplyingId(template.id);
		try {
			const result = await applyReelTemplate({ editor, template, files });
			toast.success(`Template applied: ${result.shotCount} shots`, {
				description: [
					result.hasSoundtrack ? "The reel's soundtrack was added." : null,
					result.shortClipCount > 0
						? `${result.shortClipCount} clip(s) were shorter than their shot, so they leave a gap. Trim or swap them on the timeline.`
						: null,
				]
					.filter(Boolean)
					.join(" "),
			});
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Couldn't apply the template");
		} finally {
			setApplyingId(null);
		}
	};

	return (
		<PanelView
			title="Templates"
			actions={
				<div className="flex items-center gap-1.5">
					<Button
						variant="ghost"
						size="icon"
						aria-label="Refresh templates"
						onClick={() => void load()}
					>
						<HugeiconsIcon icon={RefreshIcon} />
					</Button>
					<Button asChild variant="outline" size="sm">
						<a href={REEL_TEMPLATES_APP_URL} target="_blank" rel="noopener">
							<HugeiconsIcon icon={LinkSquare02Icon} />
							New from reel
						</a>
					</Button>
				</div>
			}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept="video/*,image/*"
				multiple
				className="hidden"
				onChange={(event) => {
					const files = Array.from(event.target.files ?? []);
					event.target.value = "";
					void handleFiles(files);
				}}
			/>

			{state.status === "loading" && (
				<div className="flex justify-center p-6">
					<Spinner />
				</div>
			)}

			{state.status === "offline" && (
				<p className="text-muted-foreground p-1 text-sm">
					The Reel Templates service isn't running. Open Kutkap from its app
					icon to start it.
				</p>
			)}

			{state.status === "ready" && state.templates.length === 0 && (
				<p className="text-muted-foreground p-1 text-sm">
					No templates yet. Click <b>New from reel</b>, paste a reel link, and
					save the template to your library.
				</p>
			)}

			{state.status === "ready" && state.templates.length > 0 && (
				<div className="flex flex-col gap-3 pb-3">
					{state.templates.map((template) => (
						<TemplateCard
							key={template.id}
							template={template}
							isApplying={applyingId === template.id}
							isDisabled={applyingId !== null}
							onUse={() => chooseClips(template)}
						/>
					))}
				</div>
			)}
		</PanelView>
	);
}

function TemplateCard({
	template,
	isApplying,
	isDisabled,
	onUse,
}: {
	template: ReelTemplateSummary;
	isApplying: boolean;
	isDisabled: boolean;
	onUse: () => void;
}) {
	const keyframes = template.keyframes.filter((k): k is string => Boolean(k));
	return (
		<div className="bg-accent/40 overflow-hidden rounded-md border">
			<div className="flex h-20 gap-px bg-black">
				{keyframes.slice(0, 5).map((keyframe) => (
					<img
						key={keyframe}
						src={serviceFileUrl({ path: keyframe })}
						alt=""
						loading="lazy"
						className="h-full min-w-0 flex-1 object-cover"
					/>
				))}
			</div>
			<div className="flex h-1.5 gap-px" aria-hidden>
				{template.shots.map((shot) => (
					<div
						key={shot.n}
						className="bg-primary/70 odd:bg-primary/40"
						style={{ flex: shot.duration }}
					/>
				))}
			</div>
			<div className="flex flex-col gap-2 p-2.5">
				<div className="line-clamp-2 text-sm font-medium">{template.title}</div>
				<div className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
					{template.hook_type && (
						<span className="text-primary">{template.hook_type}</span>
					)}
					<span>{template.format.aspect_ratio}</span>
					<span>{Math.round(template.format.duration_s)}s</span>
					<span>{template.pacing.shots} shots</span>
					<span>{template.audio_type}</span>
				</div>
				<Button size="sm" onClick={onUse} disabled={isDisabled}>
					{isApplying && <Spinner className="mr-1" />}
					{isApplying ? "Applying…" : `Use with ${template.pacing.shots} clips`}
				</Button>
			</div>
		</div>
	);
}
