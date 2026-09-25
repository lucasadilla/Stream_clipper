import { NextRequest } from "next/server";
import { z } from "zod";
import { generateClipMetadata } from "@/services/clipMetadataService";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";

const bodySchema = z.object({
  startTimeSeconds: z.number().min(0),
  endTimeSeconds: z.number().min(0),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    await ensureSessionBillingAccess(
      sessionId,
      getBillingAccountIdFromRequest(request)
    );
    const body = bodySchema.parse(await request.json());
    const metadata = await generateClipMetadata(
      sessionId,
      body.startTimeSeconds,
      body.endTimeSeconds
    );
    return jsonResponse(metadata);
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message =
      error instanceof Error ? error.message : "Failed to generate clip metadata";
    return errorResponse(message, 500);
  }
}
