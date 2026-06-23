import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const clip = await prisma.clipSuggestion.update({
      where: { id: clipSuggestionId },
      data: { status: "saved" },
    });
    return jsonResponse({ clip });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save clip";
    return errorResponse(message, 500);
  }
}
