import { NextRequest } from "next/server";
import { errorResponse, jsonResponse } from "@/lib/utils";
import {
  getAuthorizedPlatformExportPack,
  SessionAccessError,
} from "@/services/platformExportAccessService";
import { serializePlatformExportPack } from "@/services/platformExportService";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  try {
    const { packId } = await params;
    const pack = await getAuthorizedPlatformExportPack(request, packId);
    return jsonResponse({ pack: serializePlatformExportPack(pack) });
  } catch (error) {
    if (error instanceof SessionAccessError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to load exports", 500);
  }
}
