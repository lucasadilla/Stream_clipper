import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";
import {
  getEditorAssetsDir,
  toRelativeStoragePath,
} from "@/lib/storage";

const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

function safeFilename(name: string): string {
  const parsed = path.parse(name);
  const base = parsed.name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 60) || "asset";
  const ext = parsed.ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${base}-${Date.now()}${ext}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) return errorResponse("Session not found", 404);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return errorResponse("Choose an asset to upload", 400);
    if (!ALLOWED_TYPES.has(file.type)) return errorResponse("Unsupported image or video format", 400);
    if (file.size <= 0 || file.size > MAX_ASSET_BYTES) {
      return errorResponse("Assets must be smaller than 100 MB", 400);
    }

    const dir = getEditorAssetsDir(sessionId);
    await mkdir(dir, { recursive: true });
    const output = path.join(dir, safeFilename(file.name));
    await writeFile(output, Buffer.from(await file.arrayBuffer()));
    const assetPath = toRelativeStoragePath(output);
    return jsonResponse({
      assetPath,
      url: `/api/storage/${assetPath.replace(/\\/g, "/")}?inline=1`,
      mimeType: file.type,
      name: file.name,
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to upload editor asset",
      500
    );
  }
}
