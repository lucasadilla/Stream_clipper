import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonResponse } from "@/lib/utils";
import {
  requirePaidAuthUserId,
  SessionAccessError,
} from "@/services/social/socialAccessService";
import {
  disableStreamAutomation,
  getStreamAutomationSettings,
  saveStreamAutomationSettings,
  StreamAutomationSchemaPendingError,
} from "@/services/streamAutomationService";

export const runtime = "nodejs";

const updateSchema = z.object({
  sourceUrl: z.string().trim().min(1),
  enabled: z.boolean().optional(),
  autoPublishEnabled: z.boolean().optional(),
  clipsPerBroadcast: z.number().int().min(1).max(10).optional(),
  destinationAccountIds: z.array(z.string()).max(20).optional(),
});

function failure(error: unknown) {
  if (error instanceof SessionAccessError) {
    return jsonResponse({ error: error.message }, error.status);
  }
  if (error instanceof z.ZodError) {
    return jsonResponse(
      { error: error.errors[0]?.message || "Invalid Autopilot settings." },
      400
    );
  }
  if (error instanceof StreamAutomationSchemaPendingError) {
    return jsonResponse(
      { error: "Autopilot is waiting for the latest database update." },
      503
    );
  }
  return jsonResponse(
    {
      error:
        error instanceof Error
          ? error.message
          : "Could not update Autopilot settings.",
    },
    400
  );
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requirePaidAuthUserId(request);
    return jsonResponse(await getStreamAutomationSettings(userId));
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await requirePaidAuthUserId(request);
    const input = updateSchema.parse(await request.json());
    const automation = await saveStreamAutomationSettings(userId, input);
    return jsonResponse({ automation });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await requirePaidAuthUserId(request);
    const automation = await disableStreamAutomation(userId);
    return jsonResponse({ automation });
  } catch (error) {
    return failure(error);
  }
}
