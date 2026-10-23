import { z } from "zod";
import { jsonResponse } from "@/lib/utils";
import { socialApiError } from "@/lib/social/apiError";
import { requireAuthUserId } from "@/services/social/socialAccessService";
import { getPostPerformance, refreshPostPerformance } from "@/services/social/socialPerformanceService";
const idsSchema = z.array(z.string().min(1).max(100)).min(1).max(30);
export async function GET(request: Request) {
  try {
    const userId = await requireAuthUserId(request), ids = idsSchema.parse(new URL(request.url).searchParams.getAll("id"));
    return Response.json({ performance: await getPostPerformance(userId, ids) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return socialApiError(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await requireAuthUserId(request);
    const { ids } = z.object({ ids: idsSchema.max(20) }).parse(await request.json());
    return jsonResponse({ performance: await refreshPostPerformance(userId, [...new Set(ids)]) });
  } catch (error) { return socialApiError(error); }
}
