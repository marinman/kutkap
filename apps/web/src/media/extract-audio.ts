import {
	AudioBufferSource,
	BufferTarget,
	canEncodeAudio,
	Mp4OutputFormat,
	Output,
	WavOutputFormat,
} from "mediabunny";
import { createAudioContext } from "@/media/audio";
import { createTimelineAudioBuffer } from "@/media/audio";
import type { MediaAsset } from "@/media/types";
import type { SceneTracks } from "@/timeline";

export type AudioExportFormat = "m4a" | "wav";

const SAMPLE_RATE = 48000;
const AAC_BITRATE = 192_000;

export const AUDIO_EXPORT_MIME_TYPES: Record<AudioExportFormat, string> = {
	m4a: "audio/mp4",
	wav: "audio/wav",
};

/**
 * Encodes an AudioBuffer as AAC in an .m4a container, or as 16-bit WAV.
 * Falls back to WAV when the browser can't encode AAC.
 */
export async function encodeAudioBuffer({
	audioBuffer,
	format,
}: {
	audioBuffer: AudioBuffer;
	format: AudioExportFormat;
}): Promise<{ blob: Blob; format: AudioExportFormat }> {
	const useAac =
		format === "m4a" &&
		(await canEncodeAudio("aac", {
			numberOfChannels: audioBuffer.numberOfChannels,
			sampleRate: audioBuffer.sampleRate,
			bitrate: AAC_BITRATE,
		}));
	const finalFormat: AudioExportFormat = useAac ? "m4a" : "wav";

	const target = new BufferTarget();
	const output = new Output({
		format: useAac ? new Mp4OutputFormat() : new WavOutputFormat(),
		target,
	});
	const source = new AudioBufferSource(
		useAac ? { codec: "aac", bitrate: AAC_BITRATE } : { codec: "pcm-s16" },
	);
	output.addAudioTrack(source);
	await output.start();
	await source.add(audioBuffer);
	source.close();
	await output.finalize();

	if (!target.buffer) throw new Error("Audio encoding produced no data");
	return {
		blob: new Blob([target.buffer], {
			type: AUDIO_EXPORT_MIME_TYPES[finalFormat],
		}),
		format: finalFormat,
	};
}

/** Mixes the whole timeline (respecting mutes, volume and trims) into one buffer. */
export async function renderTimelineAudio({
	tracks,
	mediaAssets,
	duration,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	duration: number;
}): Promise<AudioBuffer> {
	const audioBuffer = await createTimelineAudioBuffer({
		tracks,
		mediaAssets,
		duration,
		sampleRate: SAMPLE_RATE,
	});
	if (!audioBuffer) {
		throw new Error("This project has no audio to export");
	}
	return audioBuffer;
}

/** Pulls the soundtrack out of a video file as a new audio File. */
export async function extractAudioFromVideoFile({
	file,
	format = "m4a",
}: {
	file: File;
	format?: AudioExportFormat;
}): Promise<File> {
	const context = createAudioContext();
	let audioBuffer: AudioBuffer;
	try {
		audioBuffer = await context.decodeAudioData(await file.arrayBuffer());
	} catch {
		throw new Error("This video has no audio track that can be read");
	} finally {
		void context.close();
	}

	const { blob, format: finalFormat } = await encodeAudioBuffer({
		audioBuffer,
		format,
	});
	const baseName = file.name.replace(/\.[^.]+$/, "");
	return new File([blob], `${baseName} (audio).${finalFormat}`, {
		type: blob.type,
	});
}
