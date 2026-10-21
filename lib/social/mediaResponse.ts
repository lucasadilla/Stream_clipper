import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { parseDownloadByteRange, resolveStoragePath } from "@/lib/storage";

/** Exact export preview / platform fetch, with bounded ranges and no shared caching. */
export async function socialMediaResponse(filePath: string, request: Request): Promise<Response> {
  const fullPath = resolveStoragePath(filePath);
  const file = await stat(fullPath).catch(() => null);
  if (!file?.isFile() || file.size <= 0) return new Response("Video unavailable", { status: 404 });
  const range = parseDownloadByteRange(request.headers.get("range"), file.size);
  const headers = new Headers({ "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${file.size}`);
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? file.size - 1;
  headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
  return new Response(request.method === "HEAD" ? null : createReadStream(fullPath, { start, end }) as unknown as BodyInit, { status: range ? 206 : 200, headers });
}
