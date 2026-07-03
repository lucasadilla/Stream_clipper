import { NextRequest } from "next/server";
import { getTimelineThumbnails } from "@/services/timelineThumbnailService";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const session = await prisma.streamSession.findUnique({
      where: { id: sessionId },
      select: { liveStatus: true },
    });
    const isLive =
      session?.liveStatus === "live" || session?.liveStatus === "upcoming";

    const thumbnails = await getTimelineThumbnails(sessionId, { isLive });
    return jsonResponse({ thumbnails });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load thumbnails";
    return errorResponse(message, 500);
  }
}
