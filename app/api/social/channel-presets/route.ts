import { z } from "zod";
import { jsonResponse } from "@/lib/utils";
import { socialApiError } from "@/lib/social/apiError";
import { requireAuthUserId } from "@/services/social/socialAccessService";
import { listChannelPresets, saveChannelPreset } from "@/services/social/channelPresetService";
export async function GET(request: Request) {
  try { return Response.json({ channels: await listChannelPresets(await requireAuthUserId(request)) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return socialApiError(error); }
}
export async function PUT(request: Request) {
  try {
    const userId = await requireAuthUserId(request);
    const body = z.object({ accountId: z.string().min(1).max(100), preset: z.unknown() }).parse(await request.json());
    return jsonResponse({ preset: await saveChannelPreset(userId, body.accountId, body.preset) });
  } catch (error) { return socialApiError(error); }
}
