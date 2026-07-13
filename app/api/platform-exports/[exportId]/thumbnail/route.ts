import { NextRequest } from "next/server";
import { serveStorageFileInline } from "@/lib/storage";
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
    if (!item.thumbnailPath) return errorResponse("Thumbnail not ready", 404);
    return serveStorageFileInline(item.thumbnailPath, request);
  } catch (error) {
    if (error instanceof SessionAccessError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Thumbnail failed", 500);
  }
}
