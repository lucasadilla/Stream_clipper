import { prisma } from "@/lib/db";
import { libraryEditSchema, sameOriginLibraryWrite } from "@/lib/clipLibrary";
import { getLibraryItem, ownedLibraryItem, trashLibraryItem } from "@/services/clipLibraryService";
import { purgeLibraryItem } from "@/services/clipLibraryArchiveService";
import { SessionAccessError } from "@/services/sessionAccessService";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) { return Response.json({ error: error instanceof SessionAccessError ? error.message : "This change could not be completed. Try again." }, { status: error instanceof SessionAccessError ? error.status : 409, headers }); }
export async function GET(request: Request, context: Context) {
  try { return Response.json({ item: await getLibraryItem(request, (await context.params).id) }, { headers }); }
  catch (error) { return failure(error); }
}
export async function PATCH(request: Request, context: Context) {
  if (!sameOriginLibraryWrite(request)) return Response.json({ error: "Open My Clips on this site to save changes." }, { status: 403, headers });
  try {
    const { id } = await context.params;
    const { item } = await ownedLibraryItem(request, id);
    const body = libraryEditSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Invalid clip details." }, { status: 400, headers });
    await prisma.$transaction(async tx => {
      await tx.clipLibraryItem.update({ where: { id, deletedAt: null, purgedAt: null }, data: body.data });
      if (item.sourceClipId) await tx.clipSuggestion.updateMany({ where: { id: item.sourceClipId }, data: { title: body.data.title } });
    });
    return Response.json({ saved: true }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  if (!sameOriginLibraryWrite(request)) return Response.json({ error: "Open My Clips on this site to manage videos." }, { status: 403, headers });
  try {
    const { id } = await context.params;
    const { item, accountId } = await ownedLibraryItem(request, id, true);
    const body = await request.json().catch(() => null);
    if (body?.action === "restore") await trashLibraryItem(request, id, true);
    else if (body?.action === "trash") await trashLibraryItem(request, id);
    else if (body?.action === "purge" && body.confirm === id && item.deletedAt) await purgeLibraryItem(id, accountId);
    else return Response.json({ error: "Choose a valid clip action." }, { status: 400, headers });
    return Response.json({ saved: true }, { headers });
  } catch (error) { return failure(error); }
}
