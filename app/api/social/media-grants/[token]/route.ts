import { createReadStream, existsSync, statSync } from "fs";
import { verifyMediaGrant } from "@/lib/social/oauth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const grant = verifyMediaGrant(token);
  if (!grant) {
    return new Response("Invalid or expired media grant", { status: 404 });
  }
  if (!existsSync(grant.filePath)) {
    return new Response("Media file missing", { status: 404 });
  }
  const stat = statSync(grant.filePath);
  const stream = createReadStream(grant.filePath);
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Cache-Control": "no-store",
    },
  });
}
