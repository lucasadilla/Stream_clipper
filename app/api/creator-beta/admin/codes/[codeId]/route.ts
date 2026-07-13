import { NextRequest } from "next/server";
import { z } from "zod";
import { hasCreatorBetaAdminAccess } from "@/lib/creatorBeta";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { updateCreatorBetaCode } from "@/services/creatorBetaService";

const updateSchema = z.object({
  active: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ codeId: string }> }
) {
  if (!hasCreatorBetaAdminAccess(request)) {
    return errorResponse("Owner access required", 403);
  }
  try {
    const { codeId } = await params;
    const input = updateSchema.parse(await request.json());
    const code = await updateCreatorBetaCode(codeId, {
      active: input.active,
      expiresAt:
        input.expiresAt === undefined
          ? undefined
          : input.expiresAt
            ? new Date(input.expiresAt)
            : null,
      notes: input.notes,
    });
    return jsonResponse({
      code: {
        id: code.id,
        active: code.active,
        expiresAt: code.expiresAt?.toISOString() ?? null,
        notes: code.notes,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid update", 400);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Could not update code",
      500
    );
  }
}
