import { readFile } from "fs/promises";
import { getShowcaseMedia } from "@/services/showcaseService";
import { requireAuthUserId } from "@/services/social/socialAccessService";
import { socialMediaResponse } from "@/lib/social/mediaResponse";
import { resolveStoragePath } from "@/lib/storage";
import { socialApiError } from "@/lib/social/apiError";
export async function GET(request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  try {
    const userId = await requireAuthUserId(request), { id, kind } = await context.params;
    const file = await getShowcaseMedia(id, kind, userId);
    if (!file) return new Response("Not found", { status: 404 });
    if (kind === "video" || kind === "source") return socialMediaResponse(file, request);
    const bytes = await readFile(resolveStoragePath(file));
    return new Response(request.method === "HEAD" ? null : bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
  } catch (error) { return socialApiError(error); }
}
export const HEAD = GET;
