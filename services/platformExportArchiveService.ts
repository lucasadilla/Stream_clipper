import path from "path";
import { existsSync } from "fs";
import { ZipArchive, type ArchiverError } from "archiver";
import { resolveStoragePath } from "@/lib/storage";
import {
  getPlatformExportPack,
  subtitlePathForExportOutput,
} from "@/services/platformExportService";

function safeName(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 70) || "platform-export-pack";
}

function copyText(item: NonNullable<Awaited<ReturnType<typeof getPlatformExportPack>>>["exports"][number]) {
  const hashtags = Array.isArray(item.hashtags)
    ? item.hashtags.filter((value): value is string => typeof value === "string")
    : [];
  const tags = Array.isArray(item.tags)
    ? item.tags.filter((value): value is string => typeof value === "string")
    : [];
  return [
    item.title && `TITLE\n${item.title}`,
    item.caption && `CAPTION\n${item.caption}`,
    item.postText && `POST TEXT\n${item.postText}`,
    item.description && `DESCRIPTION\n${item.description}`,
    hashtags.length > 0 && `HASHTAGS\n${hashtags.join(" ")}`,
    tags.length > 0 && `TAGS\n${tags.join(", ")}`,
    item.pinnedComment && `PINNED COMMENT\n${item.pinnedComment}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function createPlatformExportArchive(packId: string) {
  const pack = await getPlatformExportPack(packId);
  if (!pack) throw new Error("Export pack not found");

  const completed = pack.exports.filter(
    (item) => item.status === "completed" && item.outputPath
  );
  if (completed.length === 0) throw new Error("No completed exports are ready yet");

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("warning", (error: ArchiverError) =>
    console.warn("[platform-zip]", error)
  );

  for (const item of completed) {
    const folder = item.platform;
    const outputPath = resolveStoragePath(item.outputPath!);
    if (existsSync(outputPath)) {
      archive.file(outputPath, { name: `${folder}/${item.platform}.mp4` });
    }
    if (item.thumbnailPath) {
      const thumbnailPath = resolveStoragePath(item.thumbnailPath);
      if (existsSync(thumbnailPath)) {
        archive.file(thumbnailPath, { name: `${folder}/cover.jpg` });
      }
    }
    const subtitlePath = subtitlePathForExportOutput(outputPath, item.id);
    if (existsSync(subtitlePath)) {
      archive.file(subtitlePath, { name: `${folder}/captions.srt` });
    }
    archive.append(copyText(item) || "No generated copy.", {
      name: `${folder}/copy.txt`,
    });
  }

  archive.append(
    JSON.stringify(
      {
        id: pack.id,
        name: pack.name,
        clip: pack.clipSuggestion,
        createdAt: pack.createdAt,
        exports: completed.map((item) => ({
          platform: item.platform,
          presetName: item.presetName,
          width: item.width,
          height: item.height,
          durationSeconds: item.durationSeconds,
          validationWarnings: item.validationWarnings,
        })),
      },
      null,
      2
    ),
    { name: "manifest.json" }
  );

  void archive.finalize();
  return {
    archive,
    filename: `${safeName(pack.clipSuggestion.title)}-platform-pack.zip`,
  };
}
