import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, jsonResponse } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const queryStartedAt = new Date();
    const afterValue = request.nextUrl.searchParams.get("after");
    const afterDate = afterValue ? new Date(afterValue) : null;
    const after =
      afterDate && Number.isFinite(afterDate.getTime()) ? afterDate : null;
    const startParam = request.nextUrl.searchParams.get("start");
    const endParam = request.nextUrl.searchParams.get("end");
    const startValue = startParam === null ? Number.NaN : Number(startParam);
    const endValue = endParam === null ? Number.NaN : Number(endParam);
    const start = Number.isFinite(startValue) ? Math.max(0, startValue) : null;
    const end = Number.isFinite(endValue) ? Math.max(0, endValue) : null;
    const commonWhere = {
      streamSessionId: sessionId,
      ...(after ? { createdAt: { gt: after } } : {}),
      ...(start !== null ? { endTimeSeconds: { gt: start } } : {}),
      ...(end !== null ? { startTimeSeconds: { lt: end } } : {}),
    };

    const [eventWindows, transcriptChunks, audioEvents] = await Promise.all([
      prisma.eventWindow.findMany({
        where: commonWhere,
        orderBy: { startTimeSeconds: "asc" },
        select: {
          id: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          type: true,
          summary: true,
          score: true,
        },
      }),
      prisma.transcriptChunk.findMany({
        where: commonWhere,
        orderBy: { startTimeSeconds: "asc" },
        select: {
          id: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          text: true,
          rawJson: true,
        },
      }),
      prisma.audioEvent.findMany({
        where: commonWhere,
        orderBy: { startTimeSeconds: "asc" },
        select: {
          id: true,
          startTimeSeconds: true,
          endTimeSeconds: true,
          type: true,
          score: true,
          summary: true,
        },
      }),
    ]);

    return jsonResponse({
      eventWindows,
      transcriptChunks,
      audioEvents,
      // Small overlap protects against app/database clock skew and rows committed
      // while these parallel reads are in flight. Clients merge by id.
      cursor: new Date(queryStartedAt.getTime() - 5_000).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch events";
    return errorResponse(message, 500);
  }
}
