import { listLibrary } from "@/services/clipLibraryService";
import { SessionAccessError } from "@/services/sessionAccessService";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try { return Response.json(await listLibrary(request), { headers }); }
  catch (error) { return Response.json({ error: error instanceof SessionAccessError ? error.message : "Your clips could not be loaded. Try again." }, { status: error instanceof SessionAccessError ? error.status : 503, headers }); }
}
