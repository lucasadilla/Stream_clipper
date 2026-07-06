import { NextRequest } from "next/server";
import {
  readCaptionEdits,
  upsertCaptionEdit,
} from "@/services/captionEditService";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const edits = await readCaptionEdits(sessionId);
    return jsonResponse({ edits });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load caption edits";
    return errorResponse(message, 500);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    const cueId = (body as { cueId?: string }).cueId;
    if (!cueId || typeof cueId !== "string") {
      return errorResponse("cueId is required", 400);
    }

    const patch: Partial<{
      text: string;
      startTimeSeconds: number;
      endTimeSeconds: number;
    }> = {};

    if (typeof body.text === "string") patch.text = body.text;
    if (typeof body.startTimeSeconds === "number") {
      patch.startTimeSeconds = body.startTimeSeconds;
    }
    if (typeof body.endTimeSeconds === "number") {
      patch.endTimeSeconds = body.endTimeSeconds;
    }

    if (Object.keys(patch).length === 0) {
      return errorResponse("No caption fields to update", 400);
    }

    const edits = await upsertCaptionEdit(sessionId, cueId, patch);
    return jsonResponse({ edits });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save caption edit";
    return errorResponse(message, 500);
  }
}
