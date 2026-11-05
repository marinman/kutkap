import type { SavedSound } from "@/sounds/types";
import { storageService } from "./service";
import type { MediaAssetData, SerializedProject } from "./types";

/**
 * Single-file bundle of every saved project plus its media, used to move
 * projects between browser profiles (e.g. Chrome -> the Kutkap desktop app).
 *
 * Layout: 8-byte magic, uint32 LE header length, UTF-8 JSON header, then the
 * raw bytes of every blob back to back. Records are stored as-is (after the
 * storage migrations ran), so IDs and all fields round-trip unchanged. Values
 * JSON can't hold (Blob/File, Date, binary arrays) are swapped for tagged
 * references to the blob table.
 */

const MAGIC = "KUTKAP\u0000\u0001";
const PREFIX_BYTES = 12;
const FORMAT = "kutkap-projects";
const FORMAT_VERSION = 1;
export const PROJECT_BUNDLE_EXTENSION = ".kutkap";

type BlobEntry = {
	offset: number;
	size: number;
	type: string;
	name?: string;
	lastModified?: number;
	bytes?: string;
};

type BundleHeader = {
	format: typeof FORMAT;
	version: number;
	exportedAt: string;
	projects: Array<{
		record: unknown;
		media: Array<{ metadata: unknown; file: unknown }>;
	}>;
	savedSounds: unknown;
	blobs: BlobEntry[];
};

type Tagged =
	| { $kk: "blob"; i: number }
	| { $kk: "date"; v: string }
	| { $kk: "bytes"; i: number };

export type BundleProgress = {
	label: string;
	doneBytes: number;
	totalBytes: number;
};

export type ImportResult = {
	imported: string[];
	skipped: string[];
	failed: Array<{ name: string; error: string }>;
};

function isTagged(value: unknown): value is Tagged {
	return (
		typeof value === "object" &&
		value !== null &&
		"$kk" in value &&
		typeof (value as { $kk: unknown }).$kk === "string"
	);
}

class BlobTable {
	readonly entries: BlobEntry[] = [];
	readonly parts: Blob[] = [];
	private offset = 0;

	add({ blob, bytes }: { blob: Blob; bytes?: string }): number {
		const entry: BlobEntry = {
			offset: this.offset,
			size: blob.size,
			type: blob.type,
		};
		if (blob instanceof File) {
			entry.name = blob.name;
			entry.lastModified = blob.lastModified;
		}
		if (bytes) entry.bytes = bytes;
		this.entries.push(entry);
		this.parts.push(blob);
		this.offset += blob.size;
		return this.entries.length - 1;
	}

	get totalBytes() {
		return this.offset;
	}
}

function encodeValue({
	value,
	table,
}: {
	value: unknown;
	table: BlobTable;
}): unknown {
	if (value instanceof Blob) {
		return { $kk: "blob", i: table.add({ blob: value }) } satisfies Tagged;
	}
	if (value instanceof Date) {
		return { $kk: "date", v: value.toISOString() } satisfies Tagged;
	}
	if (value instanceof ArrayBuffer) {
		return {
			$kk: "bytes",
			i: table.add({ blob: new Blob([value]), bytes: "ArrayBuffer" }),
		} satisfies Tagged;
	}
	if (ArrayBuffer.isView(value)) {
		const view = new Uint8Array(
			value.buffer as ArrayBuffer,
			value.byteOffset,
			value.byteLength,
		);
		return {
			$kk: "bytes",
			i: table.add({
				blob: new Blob([view.slice()]),
				bytes: value.constructor.name,
			}),
		} satisfies Tagged;
	}
	if (Array.isArray(value)) {
		return value.map((item) => encodeValue({ value: item, table }));
	}
	if (typeof value === "object" && value !== null) {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = encodeValue({ value: item, table });
		}
		return out;
	}
	return value;
}

const TYPED_ARRAYS: Record<string, new (buffer: ArrayBuffer) => unknown> = {
	Uint8Array,
	Int8Array,
	Uint8ClampedArray,
	Uint16Array,
	Int16Array,
	Uint32Array,
	Int32Array,
	Float32Array,
	Float64Array,
};

async function decodeValue({
	value,
	header,
	data,
}: {
	value: unknown;
	header: BundleHeader;
	data: Blob;
}): Promise<unknown> {
	if (isTagged(value)) {
		if (value.$kk === "date") return new Date(value.v);
		const entry = header.blobs[value.i];
		if (!entry) throw new Error("Bundle is missing a file it refers to");
		const slice = data.slice(
			entry.offset,
			entry.offset + entry.size,
			entry.type,
		);
		if (value.$kk === "blob") {
			if (entry.name === undefined) return slice;
			return new File([slice], entry.name, {
				type: entry.type,
				lastModified: entry.lastModified,
			});
		}
		const buffer = await slice.arrayBuffer();
		if (!entry.bytes || entry.bytes === "ArrayBuffer") return buffer;
		const ctor = TYPED_ARRAYS[entry.bytes];
		return ctor ? new ctor(buffer) : buffer;
	}
	if (Array.isArray(value)) {
		return Promise.all(
			value.map((item) => decodeValue({ value: item, header, data })),
		);
	}
	if (typeof value === "object" && value !== null) {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = await decodeValue({ value: item, header, data });
		}
		return out;
	}
	return value;
}

function getRecordName({ record }: { record: unknown }): string {
	const metadata = (record as { metadata?: { name?: unknown } })?.metadata;
	return typeof metadata?.name === "string" ? metadata.name : "Untitled";
}

function getRecordId({ record }: { record: unknown }): string | null {
	if (typeof record !== "object" || record === null) return null;
	const { id, metadata } = record as {
		id?: unknown;
		metadata?: { id?: unknown };
	};
	if (typeof metadata?.id === "string") return metadata.id;
	return typeof id === "string" ? id : null;
}

export async function exportProjectsBundle({
	onProgress,
}: {
	onProgress?: (progress: BundleProgress) => void;
} = {}): Promise<{ blob: Blob; projectCount: number; mediaCount: number }> {
	const table = new BlobTable();
	const records = await storageService.listRawProjects();
	const projects: BundleHeader["projects"] = [];
	let mediaCount = 0;

	for (const [index, record] of records.entries()) {
		const projectId = getRecordId({ record });
		if (!projectId) continue;
		onProgress?.({
			label: `Reading ${getRecordName({ record })} (${index + 1}/${records.length})`,
			doneBytes: index,
			totalBytes: records.length,
		});

		const media = await storageService.listRawProjectMedia({ projectId });
		mediaCount += media.length;
		projects.push({
			record: encodeValue({ value: record, table }),
			media: media.map(({ metadata, file }) => ({
				metadata: encodeValue({ value: metadata, table }),
				file: encodeValue({ value: file, table }),
			})),
		});
	}

	const savedSounds = await storageService.loadSavedSounds();

	const header: BundleHeader = {
		format: FORMAT,
		version: FORMAT_VERSION,
		exportedAt: new Date().toISOString(),
		projects,
		savedSounds: encodeValue({ value: savedSounds, table }),
		blobs: table.entries,
	};

	const headerBytes = new TextEncoder().encode(JSON.stringify(header));
	const prefix = new Uint8Array(PREFIX_BYTES);
	prefix.set(new TextEncoder().encode(MAGIC), 0);
	new DataView(prefix.buffer).setUint32(8, headerBytes.byteLength, true);

	// Blob parts reference the stored files lazily; nothing is copied into memory here.
	const blob = new Blob([prefix, headerBytes, ...table.parts], {
		type: "application/octet-stream",
	});
	return { blob, projectCount: projects.length, mediaCount };
}

async function readHeader({
	file,
}: {
	file: Blob;
}): Promise<{ header: BundleHeader; data: Blob }> {
	const prefix = new Uint8Array(
		await file.slice(0, PREFIX_BYTES).arrayBuffer(),
	);
	const magic = new TextDecoder().decode(prefix.slice(0, 8));
	if (prefix.byteLength < PREFIX_BYTES || magic !== MAGIC) {
		throw new Error("This isn't a Kutkap projects file");
	}
	const headerLength = new DataView(prefix.buffer).getUint32(8, true);
	const headerEnd = PREFIX_BYTES + headerLength;
	const header = JSON.parse(
		await file.slice(PREFIX_BYTES, headerEnd).text(),
	) as BundleHeader;
	if (header.format !== FORMAT || header.version > FORMAT_VERSION) {
		throw new Error("Unsupported Kutkap projects file version");
	}
	return { header, data: file.slice(headerEnd) };
}

export async function importProjectsBundle({
	file,
	onProgress,
}: {
	file: Blob;
	onProgress?: (progress: BundleProgress) => void;
}): Promise<ImportResult> {
	const { header, data } = await readHeader({ file });
	const result: ImportResult = { imported: [], skipped: [], failed: [] };

	const sizeOfMedia = (media: BundleHeader["projects"][number]["media"]) =>
		media.reduce((sum, item) => {
			const entry =
				isTagged(item.file) && item.file.$kk === "blob"
					? header.blobs[item.file.i]
					: null;
			return sum + (entry?.size ?? 0);
		}, 0);
	const totalBytes = Math.max(
		1,
		header.projects.reduce((sum, p) => sum + sizeOfMedia(p.media), 0),
	);
	let doneBytes = 0;

	for (const project of header.projects) {
		const name = getRecordName({ record: project.record });
		const projectId = getRecordId({ record: project.record });
		if (!projectId) {
			result.failed.push({ name, error: "Missing project id" });
			continue;
		}

		if (await storageService.hasProject({ id: projectId })) {
			result.skipped.push(name);
			doneBytes += sizeOfMedia(project.media);
			continue;
		}

		try {
			// Media first, project record last: a failed import leaves no
			// half-restored project behind and can simply be retried.
			for (const [index, item] of project.media.entries()) {
				const metadata = (await decodeValue({
					value: item.metadata,
					header,
					data,
				})) as MediaAssetData;
				const mediaFile = (await decodeValue({
					value: item.file,
					header,
					data,
				})) as Blob;
				onProgress?.({
					label: `${name}: ${metadata.name} (${index + 1}/${project.media.length})`,
					doneBytes,
					totalBytes,
				});
				await storageService.putRawProjectMedia({
					projectId,
					metadata,
					file: mediaFile,
				});
				doneBytes += mediaFile.size;
			}

			const record = (await decodeValue({
				value: project.record,
				header,
				data,
			})) as SerializedProject;
			await storageService.putRawProject({ id: projectId, record });
			result.imported.push(name);
		} catch (error) {
			result.failed.push({
				name,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const savedSounds = (await decodeValue({
		value: header.savedSounds,
		header,
		data,
	})) as { sounds?: SavedSound[] } | null;
	if (Array.isArray(savedSounds?.sounds)) {
		await storageService.mergeSavedSounds({ sounds: savedSounds.sounds });
	}

	onProgress?.({ label: "Done", doneBytes: totalBytes, totalBytes });
	return result;
}
