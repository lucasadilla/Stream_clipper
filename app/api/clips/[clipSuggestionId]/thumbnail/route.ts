import { NextRequest } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/utils";
import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import {
  ensureClipSuggestionThumbnail,
  clipThumbRelativePath,
} from "@/services/clipThumbnailService";
import { getFramesDir, resolveStoragePath } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clipSuggestionId: string }> }
) {
  try {
    const { clipSuggestionId } = await params;
    const clip = await prisma.clipSuggestion.findUnique({
      where: { id: clipSuggestionId },
      select: {
        id: true,
        streamSessionId: true,
        streamSession: { select: { thumbnailUrl: true } },
      },
    });
    if (!clip) return errorResponse("Clip not found", 404);

    const billingAccountId = getBillingAccountIdFromRequest(request);
    try {
      await ensureSessionBillingAccess(clip.streamSessionId, billingAccountId);
    } catch (err) {
      if (err instanceof SessionAccessError) {
        return errorResponse(err.message, err.status);
      }
      throw err;
    }

    const url = await ensureClipSuggestionThumbnail(
      clip.streamSessionId,
      clip.id
    );
    if (!url) {
      const fallbackUrl = clip.streamSession.thumbnailUrl;
      if (fallbackUrl && /^https?:\/\//i.test(fallbackUrl)) {
        return Response.redirect(fallbackUrl, 307);
      }
      return errorResponse("Thumbnail not ready", 503);
    }

    const dest = path.join(
      getFramesDir(clip.streamSessionId),
      `clip_${clip.id}.jpg`
    );
    if (!existsSync(dest)) {
      // Fall back to relative resolve
      const relative = clipThumbRelativePath(clip.streamSessionId, clip.id);
      const resolved = resolveStoragePath(relative);
      if (!existsSync(resolved)) return errorResponse("Thumbnail missing", 404);
      return streamJpeg(resolved, request);
    }
    return streamJpeg(dest, request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load thumbnail";
    return errorResponse(message, 500);
  }
}

function streamJpeg(filePath: string, request: NextRequest) {
  const inline = request.nextUrl.searchParams.get("inline") !== "0";
  const stat = statSync(filePath);
  const stream = createReadStream(filePath);
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=3600",
      "Content-Disposition": inline
        ? "inline"
        : `attachment; filename="${path.basename(filePath)}"`,
    },
  });
}
