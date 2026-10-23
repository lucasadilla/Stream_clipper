import { verifyMediaGrant } from "@/lib/social/oauth";
import { socialMediaResponse } from "@/lib/social/mediaResponse";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const grant = verifyMediaGrant(token);
  if (!grant) return new Response("Invalid or expired media grant", { status: 404 });
  return socialMediaResponse(grant.filePath, request);
}
export const HEAD = GET;
