import { NextRequest } from "next/server";
import { serveStorageFile } from "@/lib/storage";
import { errorResponse } from "@/lib/utils";
import {
  getAuthorizedPlatformExport,
  SessionAccessError,
} from "@/services/platformExportAccessService";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ exportId: string }> }
) {
  try {
    const { exportId } = await params;
    const item = await getAuthorizedPlatformExport(request, exportId);
    if (item.status !== "completed" || !item.outputPath) return errorResponse("Export not ready", 404);
    return serveStorageFile(item.outputPath, `${item.platform}-${exportId}.mp4`);
  } catch (error) {
    if (error instanceof SessionAccessError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Download failed", 500);
  }
}
