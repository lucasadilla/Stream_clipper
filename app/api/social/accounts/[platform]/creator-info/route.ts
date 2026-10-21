import { prisma } from "@/lib/db";
import { forcesPrivateUploads } from "@/lib/social/capabilities";
import { requireAuthUserId, SessionAccessError } from "@/services/social/socialAccessService";
import { getPublisherContext } from "@/services/social/socialConnectionService";
import { queryCreatorInfo } from "@/services/social/publishers/tiktokPublisher";
import { jsonResponse } from "@/lib/utils";

// The dynamic segment is an account id here; it shares the existing [platform] directory.
export async function GET(request: Request, context: { params: Promise<{ platform: string }> }) {
  try {
    const userId = await requireAuthUserId(request);
    const { platform: accountId } = await context.params;
    const account = await prisma.connectedSocialAccount.findFirst({ where: { id: accountId, userId, platform: "tiktok", isActive: true }, select: { id: true } });
    if (!account) return jsonResponse({ error: "TikTok account not found" }, 404);
    const ctx = await getPublisherContext(account.id);
    const info = await queryCreatorInfo(ctx.accessToken);
    const response = jsonResponse({ creator: info, privateOnly: forcesPrivateUploads("tiktok") });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not check TikTok settings" }, error instanceof SessionAccessError ? error.status : 400);
  }
}
