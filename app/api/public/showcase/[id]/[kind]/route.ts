import { readFile } from "fs/promises";
import { getShowcaseMedia } from "@/services/showcaseService";
import { resolveStoragePath } from "@/lib/storage";
import { socialMediaResponse } from "@/lib/social/mediaResponse";
export async function GET(request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await context.params;
  const file = await getShowcaseMedia(id, kind);
  if (!file) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (kind === "video" || kind === "source") return socialMediaResponse(file, request);
  const bytes = await readFile(resolveStoragePath(file)).catch(() => null);
  return bytes ? new Response(request.method === "HEAD" ? null : bytes, { headers: { "Content-Type": "image/jpeg", "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }) : new Response("Not found", { status: 404 });
}
export const HEAD = GET;
