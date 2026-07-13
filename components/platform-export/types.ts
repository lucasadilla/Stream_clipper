import type { PlatformExportSettings, PlatformKey } from "@/lib/platforms/types";

export interface ExportResultPayload {
  id: string;
  platform: PlatformKey;
  presetName: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  title: string | null;
  caption: string | null;
  postText: string | null;
  description: string | null;
  hashtags: string[];
  tags: string[];
  quoteText: string | null;
  thumbnailText: string | null;
  pinnedComment: string | null;
  warnings: string[];
  settings: PlatformExportSettings;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  fileSizeBytes: string | null;
  errorMessage: string | null;
  videoUrl: string | null;
  downloadUrl: string | null;
  thumbnailUrl: string | null;
}

export interface ExportPackPayload {
  id: string;
  name: string;
  status: "queued" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  clip: {
    id: string;
    title: string;
    reason: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
    durationSeconds: number;
    previewUrl: string;
  };
  createdAt: string;
  updatedAt: string;
  downloadZipUrl: string;
  exports: ExportResultPayload[];
}

export interface ClipPayload {
  id: string;
  title: string;
  reason: string;
  durationSeconds: number;
  hasVideo: boolean;
  videoUrl: string | null;
  stream: {
    title: string | null;
    channelTitle: string | null;
  };
}
