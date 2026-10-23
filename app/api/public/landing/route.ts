import { getPublicImpact } from "@/services/publicImpactService";
import { getPublicShowcase } from "@/services/showcaseService";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const [impact, clips] = await Promise.all([getPublicImpact({ strict: true }), getPublicShowcase({ strict: true })]);
    return Response.json({ impact, clips }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Landing results temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
