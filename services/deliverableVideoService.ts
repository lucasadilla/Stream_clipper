import fs from "fs/promises";
import { canDecodeVideoFrame, probeMedia } from "@/lib/ffmpeg";
import { resolveStoragePath } from "@/lib/storage";

export interface DeliverableVideoInspection {
  ok: boolean;
  reason: string | null;
  sizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
}

const successfulInspectionCache = new Map<
  string,
  { sizeBytes: number; mtimeMs: number; inspection: DeliverableVideoInspection }
>();

export async function inspectDeliverableVideo(
  filePath: string,
  options?: { relativeToStorage?: boolean }
): Promise<DeliverableVideoInspection> {
  const absolutePath = options?.relativeToStorage
    ? resolveStoragePath(filePath)
    : filePath;
  const empty = {
    sizeBytes: 0,
    durationSeconds: 0,
    width: 0,
    height: 0,
  };

  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isFile()) {
    return { ok: false, reason: "The rendered file is no longer on disk.", ...empty };
  }
  if (stat.size < 80_000) {
    return {
      ok: false,
      reason: "The rendered file is incomplete or unexpectedly small.",
      ...empty,
      sizeBytes: stat.size,
    };
  }

  const cached = successfulInspectionCache.get(absolutePath);
  if (cached?.sizeBytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.inspection;
  }

  const probe = await probeMedia(absolutePath).catch(() => null);
  if (
    !probe?.videoCodec ||
    probe.width <= 0 ||
    probe.height <= 0 ||
    probe.durationSeconds <= 0
  ) {
    return {
      ok: false,
      reason: "The rendered file does not contain a complete playable video stream.",
      sizeBytes: stat.size,
      durationSeconds: probe?.durationSeconds ?? 0,
      width: probe?.width ?? 0,
      height: probe?.height ?? 0,
    };
  }

  const sampleTime = Math.min(1, Math.max(0, probe.durationSeconds / 2));
  if (!(await canDecodeVideoFrame(absolutePath, sampleTime))) {
    return {
      ok: false,
      reason: "The rendered video could not be decoded and must be rendered again.",
      sizeBytes: stat.size,
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
    };
  }

  const inspection: DeliverableVideoInspection = {
    ok: true,
    reason: null,
    sizeBytes: stat.size,
    durationSeconds: probe.durationSeconds,
    width: probe.width,
    height: probe.height,
  };
  successfulInspectionCache.set(absolutePath, {
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    inspection,
  });
  return inspection;
}

export async function assertDeliverableVideo(filePath: string): Promise<void> {
  const inspection = await inspectDeliverableVideo(filePath);
  if (!inspection.ok) {
    throw new Error(
      inspection.reason ?? "The rendered video failed its delivery check."
    );
  }
}
