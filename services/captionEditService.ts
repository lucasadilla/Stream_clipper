import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { getCaptionEditsPath } from "@/lib/storage";
import type { CaptionEditsMap } from "@/lib/captionEdits";

interface CaptionEditsFile {
  version: 1;
  edits: CaptionEditsMap;
}

function emptyFile(): CaptionEditsFile {
  return { version: 1, edits: {} };
}

export async function readCaptionEdits(
  streamSessionId: string
): Promise<CaptionEditsMap> {
  const filePath = getCaptionEditsPath(streamSessionId);
  if (!existsSync(filePath)) return {};

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as CaptionEditsFile;
    return parsed.edits ?? {};
  } catch {
    return {};
  }
}

async function writeCaptionEdits(
  streamSessionId: string,
  edits: CaptionEditsMap
): Promise<void> {
  const filePath = getCaptionEditsPath(streamSessionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload: CaptionEditsFile = { version: 1, edits };
  await writeFile(filePath, JSON.stringify(payload));
}

export async function upsertCaptionEdit(
  streamSessionId: string,
  cueId: string,
  patch: Partial<{
    text: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
  }>
): Promise<CaptionEditsMap> {
  const edits = await readCaptionEdits(streamSessionId);
  edits[cueId] = {
    ...edits[cueId],
    ...patch,
  };
  await writeCaptionEdits(streamSessionId, edits);
  return edits;
}
