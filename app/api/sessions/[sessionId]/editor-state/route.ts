import { errorResponse, jsonResponse } from "@/lib/utils";
import {
  readEditorState,
  writeEditorState,
} from "@/services/editorStateService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    await ensureSessionBillingAccess(
      sessionId,
      getBillingAccountIdFromRequest(request)
    );
    return jsonResponse({ state: await readEditorState(sessionId) });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load editor state",
      500
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    await ensureSessionBillingAccess(
      sessionId,
      getBillingAccountIdFromRequest(request)
    );
    const body = await request.json();
    return jsonResponse({ state: await writeEditorState(sessionId, body.state) });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Failed to save editor state",
      500
    );
  }
}
