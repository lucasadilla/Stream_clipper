import { prisma } from "@/lib/db";
import { assertOwnedLibraryFile } from "@/lib/clipLibraryStorage";
import { serveStorageFile } from "@/lib/storage";
import { videoDownloadFilename } from "@/lib/downloadFilename";
import { ownedLibraryItem } from "@/services/clipLibraryService";
import { SessionAccessError } from "@/services/sessionAccessService";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { id, assetId } = await context.params;
    const { item, accountId } = await ownedLibraryItem(request, id);
    const asset = await prisma.clipLibraryAsset.findFirst({ where: { id: assetId, itemId: id, status: "ready" } });
    const params = new URL(request.url).searchParams;
    const thumbnail = params.get("kind") === "thumbnail";
    const file = thumbnail ? asset?.thumbnailPath : asset?.outputPath;
    if (!file || !asset) return new Response("Saved file unavailable", { status: 404 });
    await assertOwnedLibraryFile(file, accountId, id);
    const response = await serveStorageFile(file, videoDownloadFilename(`${item.title} - ${asset.platform}${asset.includeCaptions ? " - captions" : " - no captions"}`), request);
    if (params.get("download") !== "1" || thumbnail) response.headers.set("Content-Disposition", "inline");
    response.headers.set("Cache-Control", "private, no-store"); response.headers.set("Vary", "Cookie"); response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error) {
    return new Response(error instanceof SessionAccessError ? error.message : "Saved file unavailable", { status: error instanceof SessionAccessError ? error.status : 404, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  }
}
export const HEAD = GET;
