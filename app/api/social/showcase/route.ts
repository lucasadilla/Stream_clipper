import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthUserId } from "@/services/social/socialAccessService";
import { socialApiError } from "@/lib/social/apiError";
import { isShowcaseAdmin, requireShowcaseAdmin, submitShowcase, manageShowcase } from "@/services/showcaseService";

const submission = z.object({ exportId: z.string().min(1).max(100), creatorName: z.string().trim().min(1).max(80), title: z.string().trim().min(3).max(140), category: z.enum(["gaming", "podcast", "irl", "other"]), consent: z.literal(true) });
export async function GET(request: Request) {
  try {
    const userId = await requireAuthUserId(request), admin = new URL(request.url).searchParams.get("review") === "1";
    if (admin) await requireShowcaseAdmin(userId);
    const [submissions, exports] = await Promise.all([
      prisma.showcaseClip.findMany({ where: admin ? { status: { in: ["pending", "approved"] } } : { userId }, orderBy: { createdAt: "desc" }, take: 100,
        select: { id: true, platformExportId: true, title: true, creatorName: true, sourceTitle: true, status: true, consentAt: true, sourceVideoPath: true } }),
      admin ? Promise.resolve([]) : prisma.platformExport.findMany({ where: { status: "completed", outputPath: { not: null }, width: { lt: 1500 }, streamSession: { billingAccount: { userId } } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, title: true, platform: true, width: true, height: true } }),
    ]);
    return Response.json({ submissions: submissions.map(({ sourceVideoPath, ...row }) => ({ ...row, hasSourceVideo: Boolean(sourceVideoPath) })), exports: exports.filter(row => row.width && row.height && row.width < row.height), canReview: isShowcaseAdmin(userId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return socialApiError(error); }
}
export async function POST(request: Request) {
  try { const userId = await requireAuthUserId(request); const data = submission.parse(await request.json()); await submitShowcase(userId, data); return Response.json({ ok: true }); }
  catch (error) { return socialApiError(error); }
}
export async function PATCH(request: Request) {
  try {
    const userId = await requireAuthUserId(request);
    const { id, action } = z.object({ id: z.string().min(1).max(100), action: z.enum(["withdraw", "resubmit", "approve", "reject"]) }).parse(await request.json());
    await manageShowcase(userId, id, action); return Response.json({ ok: true });
  } catch (error) { return socialApiError(error); }
}
