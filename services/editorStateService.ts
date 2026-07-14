import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import {
  emptyEditorState,
  normalizeEditorState,
  type EditorState,
} from "@/lib/editorState";
import { getEditorStatePath } from "@/lib/storage";

export async function readEditorState(sessionId: string): Promise<EditorState> {
  const filePath = getEditorStatePath(sessionId);
  if (!existsSync(filePath)) return emptyEditorState();
  try {
    return normalizeEditorState(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return emptyEditorState();
  }
}

export async function writeEditorState(
  sessionId: string,
  value: unknown
): Promise<EditorState> {
  const state = normalizeEditorState(value);
  const filePath = getEditorStatePath(sessionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(state), "utf8");
  await rename(tempPath, filePath);
  return state;
}
