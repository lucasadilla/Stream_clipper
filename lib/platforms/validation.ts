import { PLATFORM_PRESETS } from "@/lib/platforms/presets";
import type { PlatformValidationInput } from "@/lib/platforms/types";

function ratioNear(width: number, height: number, expected: number): boolean {
  if (width <= 0 || height <= 0) return false;
  return Math.abs(width / height - expected) < 0.03;
}

export function validatePlatformExport(input: PlatformValidationInput): string[] {
  const preset = PLATFORM_PRESETS[input.platform];
  const warnings: string[] = [];
  const output = preset.outputs.find(
    (item) => item.width === input.width && item.height === input.height
  );

  if (!output) {
    warnings.push(`${preset.name} output uses an unusual resolution (${input.width}x${input.height}).`);
  } else {
    const [rw, rh] = output.aspectRatio.split(":").map(Number);
    if (!ratioNear(input.width, input.height, rw! / rh!)) {
      warnings.push(`${preset.name} output does not match the ${output.aspectRatio} preset.`);
    }
  }

  if (preset.hardDuration?.min && input.durationSeconds < preset.hardDuration.min) {
    warnings.push(`${preset.name} export is shorter than ${preset.hardDuration.min} seconds.`);
  }
  if (preset.hardDuration?.max && input.durationSeconds > preset.hardDuration.max) {
    warnings.push(`${preset.name} export is over ${preset.hardDuration.max} seconds.`);
  }
  if (preset.titleLimit && (input.copy.title?.length ?? 0) > preset.titleLimit) {
    warnings.push(`${preset.name} title is over ${preset.titleLimit} characters.`);
  }
  if (preset.captionLimit && (input.copy.caption?.length ?? 0) > preset.captionLimit) {
    warnings.push(`${preset.name} caption is over ${preset.captionLimit} characters.`);
  }
  if (preset.postTextLimit && (input.copy.postText?.length ?? 0) > preset.postTextLimit) {
    warnings.push(`${preset.name} post text is over ${preset.postTextLimit} characters.`);
  }
  const hashtagLimit = preset.hashtagRange?.hardMax ?? preset.hashtagRange?.max;
  if (hashtagLimit != null && input.copy.hashtags.length > hashtagLimit) {
    warnings.push(`${preset.name} copy has more than ${hashtagLimit} hashtags.`);
  }
  if (preset.maxFileSizeBytes && input.fileSizeBytes > preset.maxFileSizeBytes) {
    warnings.push(`${preset.name} file is larger than ${Math.round(preset.maxFileSizeBytes / 1024 / 1024)} MB.`);
  }
  if (input.format && input.format.toLowerCase() !== "mp4") {
    warnings.push(`${preset.name} expects an MP4 file.`);
  }
  if (input.videoCodec && !/h264|avc/i.test(input.videoCodec)) {
    warnings.push(`${preset.name} works best with H.264 video.`);
  }
  if (input.audioCodec && !/aac/i.test(input.audioCodec)) {
    warnings.push(`${preset.name} works best with AAC audio.`);
  }
  return warnings;
}
