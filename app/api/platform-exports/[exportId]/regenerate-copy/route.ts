import { NextRequest } from "next/server";
import { errorResponse, jsonResponse } from "@/lib/utils";
import {
  getAuthorizedPlatformExport,
  SessionAccessError,
} from "@/services/platformExportAccessService";
import { regeneratePlatformExportCopy } from "@/services/platformExportService";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ exportId: string }> }
) {
  try {
    const { exportId } = await params;
    await getAuthorizedPlatformExport(request, exportId);
    const item = await regeneratePlatformExportCopy(exportId);
    return jsonResponse({ export: item });
  } catch (error) {
    if (error instanceof SessionAccessError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Copy generation failed", 500);
  }
}
