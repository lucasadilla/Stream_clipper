import { prisma } from "@/lib/db";
import { probeMedia } from "@/lib/ffmpeg";
import { toJsonValue } from "@/lib/utils";

export const AUDIO_SOURCE_PROFILE_VERSION = "audio-sources-v1" as const;

export type AudioSourceRole =
  | "microphone"
  | "communications"
  | "gameplay"
  | "system"
  | "music"
  | "unknown";

export interface AudioStreamProfile {
  streamIndex: number;
  channels?: number;
  channelLayout?: string;
  codec?: string;
  title?: string;
  language?: string;
  likelyRole: AudioSourceRole;
  roleConfidence: number;
}

export interface AudioSourceProfile {
  version: typeof AUDIO_SOURCE_PROFILE_VERSION;
  analyzedAt: string;
  streams: AudioStreamProfile[];
  hasMeaningfullySeparateSources: boolean;
  warnings: string[];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function classify(title: string): { role: AudioSourceRole; confidence: number } {
  const normalized = title.toLocaleLowerCase();
  if (/\b(mic|microphone|host|creator|commentary|voice)\b/.test(normalized)) {
    return { role: "microphone", confidence: 0.82 };
  }
  if (/\b(discord|chat|guest|remote|call|communications?)\b/.test(normalized)) {
    return { role: "communications", confidence: 0.82 };
  }
  if (/\b(game|gameplay|console)\b/.test(normalized)) {
    return { role: "gameplay", confidence: 0.78 };
  }
  if (/\b(music|soundtrack)\b/.test(normalized)) {
    return { role: "music", confidence: 0.78 };
  }
  if (/\b(system|desktop|computer|monitor|output)\b/.test(normalized)) {
    return { role: "system", confidence: 0.72 };
  }
  return { role: "unknown", confidence: 0 };
}

export async function analyzeAudioSources(
  inputPath: string
): Promise<AudioSourceProfile> {
  const probe = await probeMedia(inputPath);
  const rawStreams = Array.isArray(probe.raw.streams) ? probe.raw.streams : [];
  const streams = rawStreams.flatMap((value, fallbackIndex) => {
    const stream = objectValue(value);
    if (stream.codec_type !== "audio") return [];
    const tags = objectValue(stream.tags);
    const title =
      typeof tags.title === "string"
        ? tags.title
        : typeof tags.handler_name === "string"
          ? tags.handler_name
          : "";
    const classified = classify(title);
    return [{
      streamIndex:
        typeof stream.index === "number" ? stream.index : fallbackIndex,
      ...(typeof stream.channels === "number" ? { channels: stream.channels } : {}),
      ...(typeof stream.channel_layout === "string"
        ? { channelLayout: stream.channel_layout }
        : {}),
      ...(typeof stream.codec_name === "string" ? { codec: stream.codec_name } : {}),
      ...(title ? { title } : {}),
      ...(typeof tags.language === "string" ? { language: tags.language } : {}),
      likelyRole: classified.role,
      roleConfidence: classified.confidence,
    } satisfies AudioStreamProfile];
  });
  const identifiedRoles = streams.filter(
    (stream) => stream.roleConfidence >= 0.7 && stream.likelyRole !== "unknown"
  );
  const roleCount = new Set(identifiedRoles.map((stream) => stream.likelyRole)).size;
  const warnings: string[] = [];
  if (streams.some((stream) => stream.channels === 2)) {
    warnings.push(
      "Stereo channels are preserved as layout metadata and are not assumed to represent separate people."
    );
  }
  if (streams.length > 1 && roleCount < 2) {
    warnings.push(
      "Multiple audio streams exist, but their labels do not safely identify distinct sources."
    );
  }
  return {
    version: AUDIO_SOURCE_PROFILE_VERSION,
    analyzedAt: new Date().toISOString(),
    streams,
    hasMeaningfullySeparateSources: streams.length > 1 && roleCount >= 2,
    warnings,
  };
}

export async function ensureSessionAudioSourceProfile(
  streamSessionId: string,
  inputPath: string
): Promise<AudioSourceProfile> {
  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    select: { metadataJson: true },
  });
  if (!session) throw new Error("Session not found");
  const metadata = objectValue(session.metadataJson);
  const cached = objectValue(metadata.audioSourceProfile);
  if (cached.version === AUDIO_SOURCE_PROFILE_VERSION) {
    return cached as unknown as AudioSourceProfile;
  }
  const profile = await analyzeAudioSources(inputPath);
  await prisma.$transaction(async (tx) => {
    const latest = await tx.streamSession.findUnique({
      where: { id: streamSessionId },
      select: { metadataJson: true },
    });
    if (!latest) throw new Error("Session not found");
    await tx.streamSession.update({
      where: { id: streamSessionId },
      data: {
        metadataJson: toJsonValue({
          ...objectValue(latest.metadataJson),
          audioSourceProfile: profile,
        }),
      },
    });
  });
  return profile;
}
