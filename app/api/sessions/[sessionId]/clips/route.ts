import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createManualClip } from "@/services/suggestClipsService";
import { errorResponse, jsonResponse } from "@/lib/utils";

const clipSchema = z.object({
  title: z.string().min(1),
  startTimeSeconds: z.number().min(0),
  endTimeSeconds: z.number().min(0),
  reason: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    const data = clipSchema.parse(body);

    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return errorResponse("Session not found", 404);

    const clip = await createManualClip(sessionId, data);
    return jsonResponse({ clip }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to create clip";
    return errorResponse(message, 500);
  }
}
