import { prisma } from "@/lib/db";
import { socialMediaResponse } from "@/lib/social/mediaResponse";
import { requireAuthUserId, SessionAccessError } from "@/services/social/socialAccessService";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const userId = await requireAuthUserId(request);
    const { jobId } = await context.params;
    const job = await prisma.socialPublishJob.findFirst({ where: { id: jobId, publishGroup: { userId } }, select: { videoPath: true } });
    if (!job?.videoPath) return new Response("Video not found", { status: 404 });
    return socialMediaResponse(job.videoPath, request);
  } catch (error) {
    return new Response(error instanceof SessionAccessError ? error.message : "Preview unavailable", { status: error instanceof SessionAccessError ? error.status : 400 });
  }
}

export const HEAD = GET;
