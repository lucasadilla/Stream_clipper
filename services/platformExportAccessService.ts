import { getBillingAccountIdFromRequest } from "@/services/billingService";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import {
  getPlatformExportFile,
  getPlatformExportPack,
} from "@/services/platformExportService";

export { SessionAccessError };

export async function getAuthorizedPlatformExportPack(
  request: Request,
  packId: string
) {
  const pack = await getPlatformExportPack(packId);
  if (!pack) throw new SessionAccessError("Export pack not found", 404);
  await ensureSessionBillingAccess(
    pack.streamSessionId,
    getBillingAccountIdFromRequest(request)
  );
  return pack;
}

export async function getAuthorizedPlatformExport(
  request: Request,
  exportId: string
) {
  const platformExport = await getPlatformExportFile(exportId);
  if (!platformExport) throw new SessionAccessError("Platform export not found", 404);
  await ensureSessionBillingAccess(
    platformExport.streamSessionId,
    getBillingAccountIdFromRequest(request)
  );
  return platformExport;
}
