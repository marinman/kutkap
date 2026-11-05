"use client";

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileExportIcon, FileImportIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditor } from "@/editor/use-editor";
import {
	PROJECT_BUNDLE_EXTENSION,
	exportProjectsBundle,
	importProjectsBundle,
	type BundleProgress,
} from "@/services/storage/project-bundle";

const TOAST_ID = "projects-transfer";

function formatBytes({ bytes }: { bytes: number }): string {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function showProgress({ progress }: { progress: BundleProgress }) {
	const percent = Math.round(
		(progress.doneBytes / Math.max(1, progress.totalBytes)) * 100,
	);
	toast.loading(`${percent}% · ${progress.label}`, { id: TOAST_ID });
}

export function ProjectsTransferMenu() {
	const editor = useEditor();
	const inputRef = useRef<HTMLInputElement>(null);
	const [isBusy, setIsBusy] = useState(false);

	const handleExport = async () => {
		setIsBusy(true);
		toast.loading("Preparing export…", { id: TOAST_ID });
		try {
			const { blob, projectCount, mediaCount } = await exportProjectsBundle({
				onProgress: (progress) => showProgress({ progress }),
			});
			if (projectCount === 0) {
				toast.info("There are no projects to export", { id: TOAST_ID });
				return;
			}
			const stamp = new Date().toISOString().slice(0, 10);
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `kutkap-projects-${stamp}${PROJECT_BUNDLE_EXTENSION}`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			// Keep the URL alive while the browser writes a possibly large file.
			setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
			toast.success(
				`Exported ${projectCount} project${projectCount === 1 ? "" : "s"} and ${mediaCount} media file${mediaCount === 1 ? "" : "s"} (${formatBytes({ bytes: blob.size })})`,
				{
					id: TOAST_ID,
					description: `Saved as ${link.download}. Open Kutkap and choose Import projects.`,
				},
			);
		} catch (error) {
			console.error("Project export failed:", error);
			toast.error("Export failed", {
				id: TOAST_ID,
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setIsBusy(false);
		}
	};

	const handleFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;

		setIsBusy(true);
		toast.loading(`Reading ${file.name}…`, { id: TOAST_ID });
		try {
			const result = await importProjectsBundle({
				file,
				onProgress: (progress) => showProgress({ progress }),
			});
			await editor.project.loadAllProjects();

			const parts = [
				`Imported ${result.imported.length} project${result.imported.length === 1 ? "" : "s"}`,
			];
			if (result.skipped.length > 0) {
				parts.push(`skipped ${result.skipped.length} already here`);
			}
			const description = result.failed
				.map(({ name, error }) => `${name}: ${error}`)
				.join("\n");
			if (result.failed.length > 0) {
				toast.warning(`${parts.join(", ")}, ${result.failed.length} failed`, {
					id: TOAST_ID,
					description,
					duration: 15000,
				});
			} else {
				toast.success(parts.join(", "), { id: TOAST_ID });
			}
		} catch (error) {
			console.error("Project import failed:", error);
			toast.error("Import failed", {
				id: TOAST_ID,
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setIsBusy(false);
		}
	};

	return (
		<>
			<input
				ref={inputRef}
				type="file"
				accept={`${PROJECT_BUNDLE_EXTENSION},application/octet-stream`}
				className="hidden"
				onChange={handleFileChosen}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						size="lg"
						variant="outline"
						className="flex px-4"
						disabled={isBusy}
						aria-label="Export or import projects"
					>
						<HugeiconsIcon icon={FileExportIcon} className="size-4" />
						<span className="text-sm font-medium hidden md:block">
							Move projects
						</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-64">
					<DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
						Move projects and their media between Chrome and the Kutkap app.
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={handleExport}>
						<HugeiconsIcon icon={FileExportIcon} className="size-4" />
						Export all projects
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => inputRef.current?.click()}>
						<HugeiconsIcon icon={FileImportIcon} className="size-4" />
						Import projects…
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
