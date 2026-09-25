import { NextRequest } from "next/server";
import { serveStorageFile, serveStorageFileInline } from "@/lib/storage";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import { ensureSessionBillingAccess } from "@/services/sessionAccessService";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const sessionId = pathSegments[1];
    if (!sessionId) return new Response("Not found", { status: 404 });
    await ensureSessionBillingAccess(
      sessionId,
      getBillingAccountIdFromRequest(request)
    );
    const relativePath = pathSegments.join("/");
    const inline = request.nextUrl.searchParams.get("inline") === "1";
    if (inline) {
      return await serveStorageFileInline(relativePath, request);
    }
    return await serveStorageFile(relativePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
