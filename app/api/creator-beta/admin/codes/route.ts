import { NextRequest } from "next/server";
import { z } from "zod";
import { hasCreatorBetaAdminAccess } from "@/lib/creatorBeta";
import { errorResponse, jsonResponse } from "@/lib/utils";
import {
  createCreatorBetaCode,
  listCreatorBetaCodes,
  serializeCreatorBetaCode,
} from "@/services/creatorBetaService";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function authorize(request: Request): Response | null {
  if (hasCreatorBetaAdminAccess(request)) return null;
  return errorResponse(
    "Set CREATOR_BETA_ADMIN_SECRET and enter the matching owner secret.",
    403
  );
}

export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  const codes = await listCreatorBetaCodes();
  return jsonResponse({ codes: codes.map(serializeCreatorBetaCode) });
}

export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const input = createSchema.parse(await request.json());
    const { item, plainCode } = await createCreatorBetaCode({
      name: input.name,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      notes: input.notes,
    });
    return jsonResponse(
      {
        code: {
          id: item.id,
          name: item.name,
          codeHint: item.codeHint,
          active: item.active,
          used: false,
          usedBy: null,
          usedAt: null,
          expiresAt: item.expiresAt?.toISOString() ?? null,
          notes: item.notes,
          createdAt: item.createdAt.toISOString(),
        },
        privateCode: plainCode,
        message: "Copy this private code now. It cannot be viewed again.",
      },
      201
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid code details", 400);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Could not create code",
      500
    );
  }
}
