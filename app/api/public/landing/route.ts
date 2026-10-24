import { getPublicImpact } from "@/services/publicImpactService";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const impact = await getPublicImpact({ strict: true });
    return Response.json({ impact }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Landing results temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
