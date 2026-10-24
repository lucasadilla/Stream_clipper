import { prisma } from "@/lib/db";
import { landingEditorInput, sameOriginMutation } from "@/lib/landingEditor";
import { canEditFeaturedShorts, refreshFeaturedShorts } from "@/services/landingFeaturedService";
import { requireAuthUserId, SessionAccessError } from "@/services/social/socialAccessService";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
async function authorized(request: Request) {
  const userId = await requireAuthUserId(request);
  if (!await canEditFeaturedShorts(userId)) throw new SessionAccessError("Connect @StreamClipperAdmin to manage its featured clips.", 403);
}
function failure(error: unknown) {
  return Response.json({ error: error instanceof SessionAccessError ? error.message : "Featured clips are temporarily unavailable." }, { status: error instanceof SessionAccessError ? error.status : 503, headers });
}
export async function GET(request: Request) {
  const accessOnly = new URL(request.url).searchParams.get("access") === "1";
  try {
    await authorized(request);
    if (accessOnly) return Response.json({ canEdit: true }, { headers });
    const videos = await prisma.landingFeaturedVideo.findMany({ orderBy: { publishedAt: "desc" }, take: 200 });
    return Response.json({ videos: videos.map(video => ({ ...video, views: video.views?.toString() ?? null })) }, { headers });
  } catch (error) {
    if (accessOnly && error instanceof SessionAccessError) return Response.json({ canEdit: false }, { headers });
    return failure(error);
  }
}
export async function PATCH(request: Request) {
  if (!sameOriginMutation(request)) return Response.json({ error: "Open the editor on this site to save changes." }, { status: 403, headers });
  try {
    await authorized(request);
    const parsed = landingEditorInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid selection." }, { status: 400, headers });
    const input = parsed.data;
    if ("pins" in input) {
      await prisma.$transaction(async tx => {
        const ids = input.pins.filter((id): id is string => id !== null);
        const candidates = await tx.landingFeaturedVideo.findMany({ where: { id: { in: ids }, eligible: true, available: true }, select: { id: true } });
        if (candidates.length !== ids.length) throw new SessionAccessError("Pin available Shorts with automatic picks enabled.", 400);
        await tx.landingFeaturedVideo.updateMany({ where: { pinSlot: { not: null } }, data: { pinSlot: null } });
        for (const [slot, id] of input.pins.entries()) if (id) await tx.landingFeaturedVideo.update({ where: { id }, data: { pinSlot: slot } });
      }, { isolationLevel: "Serializable" });
    } else {
      const exists = await prisma.landingFeaturedVideo.findUnique({ where: { id: input.id }, select: { id: true } });
      if (!exists) return Response.json({ error: "Video not found." }, { status: 404, headers });
      await prisma.landingFeaturedVideo.update({ where: { id: input.id }, data: {
        ...(input.eligible !== undefined ? { eligible: input.eligible, ...(input.eligible ? {} : { pinSlot: null }) } : {}),
        ...(input.source !== undefined ? { sourceVideoId: input.source?.videoId ?? null, sourceStartSeconds: input.source?.startSeconds ?? null, sourceEndSeconds: input.source?.endSeconds ?? null } : {}),
      } });
    }
    return Response.json({ saved: true }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return Response.json({ error: "Open the editor on this site to refresh." }, { status: 403, headers });
  try {
    await authorized(request);
    const refreshed = await refreshFeaturedShorts();
    return Response.json({ message: refreshed ? "Channel videos refreshed." : "The channel is already up to date, or a refresh is in progress. Refresh checks run daily." }, { headers });
  } catch (error) { return failure(error); }
}
