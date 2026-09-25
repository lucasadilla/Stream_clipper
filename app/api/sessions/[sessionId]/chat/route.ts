import { NextRequest } from "next/server";
import { getChatMessages } from "@/services/chatIngestionService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    await ensureSessionBillingAccess(
      sessionId,
      getBillingAccountIdFromRequest(request)
    );
    const sp = request.nextUrl.searchParams;
    const limit = parseInt(sp.get("limit") ?? "300", 10);
    const aroundRaw = sp.get("around");
    const windowRaw = sp.get("window");
    const aroundSeconds =
      aroundRaw != null && aroundRaw !== ""
        ? Number(aroundRaw)
        : null;
    const windowSeconds =
      windowRaw != null && windowRaw !== ""
        ? Number(windowRaw)
        : undefined;

    const messages = await getChatMessages(sessionId, {
      limit: Number.isFinite(limit) ? limit : 300,
      aroundSeconds:
        aroundSeconds != null && Number.isFinite(aroundSeconds)
          ? aroundSeconds
          : null,
      windowSeconds:
        windowSeconds != null && Number.isFinite(windowSeconds)
          ? windowSeconds
          : undefined,
    });
    return jsonResponse({ messages });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to fetch chat";
    return errorResponse(message, 500);
  }
}
