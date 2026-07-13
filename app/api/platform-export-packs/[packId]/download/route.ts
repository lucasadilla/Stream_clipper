import { Readable } from "stream";
import { NextRequest } from "next/server";
import { errorResponse } from "@/lib/utils";
import {
  getAuthorizedPlatformExportPack,
  SessionAccessError,
} from "@/services/platformExportAccessService";
import { createPlatformExportArchive } from "@/services/platformExportArchiveService";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  try {
    const { packId } = await params;
    await getAuthorizedPlatformExportPack(request, packId);
    const { archive, filename } = await createPlatformExportArchive(packId);
    return new Response(Readable.toWeb(archive) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof SessionAccessError) return errorResponse(error.message, error.status);
    return errorResponse(error instanceof Error ? error.message : "Failed to build ZIP", 500);
  }
}
