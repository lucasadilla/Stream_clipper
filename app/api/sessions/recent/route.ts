import { prisma } from "@/lib/db";
import { requireAuthUserId, SessionAccessError } from "@/services/social/socialAccessService";
import { REPLACED_SESSION_STATUS } from "@/services/sessionCleanupService";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const userId = await requireAuthUserId(request);
    const billing = await prisma.billingAccount.findUnique({ where: { userId }, select: { id: true } });
    if (!billing) return Response.json({ session: null }, { headers });
    const where = { billingAccountId: billing.id, NOT: { liveStatus: REPLACED_SESSION_STATUS } };
    const preferred = new URL(request.url).searchParams.get("last");
    const select = { id: true, title: true } as const;
    const saved = preferred && /^[a-zA-Z0-9_-]{1,100}$/.test(preferred)
      ? await prisma.streamSession.findFirst({ where: { ...where, id: preferred }, select }) : null;
    const session = saved ?? await prisma.streamSession.findFirst({ where, orderBy: { updatedAt: "desc" }, select });
    return Response.json({ session }, { headers });
  } catch (error) {
    if (error instanceof SessionAccessError && error.status === 401) return Response.json({ session: null }, { headers });
    return Response.json({ error: "Could not load your last session." }, { status: 503, headers });
  }
}
