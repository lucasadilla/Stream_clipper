import { getRuntimeHealthReport } from "@/lib/runtimeHealth";
import { errorResponse, jsonResponse } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonResponse(await getRuntimeHealthReport());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Health check failed";
    console.error("[health]", message);
    return errorResponse(message, 500);
  }
}
