import { NextRequest } from "next/server";
import { serveStorageFile } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";
import {
  getAuthorizedPlatformExport,
  SessionAccessError,
} from "@/services/platformExportAccessService";
import { inspectDeliverableVideo } from "@/services/deliverableVideoService";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ exportId: string }> }
) {
  try {
    const { exportId } = await params;
    const item = await getAuthorizedPlatformExport(request, exportId);
    if (item.status !== "completed" || !item.outputPath) return errorResponse("Export not ready", 404);
    const inspection = await inspectDeliverableVideo(item.outputPath, {
      relativeToStorage: true,
    });
    if (!inspection.ok) {
      return errorResponse(
        `${inspection.reason ?? "Export file is unavailable"} Generate the export again.`,
        inspection.sizeBytes === 0 ? 404 : 409
      );
    }
    return serveStorageFile(item.outputPath, `${item.platform}-${exportId}.mp4`);
  } catch (error) {
    if (error instanceof SessionAccessError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Download failed", 500);
  }
}
