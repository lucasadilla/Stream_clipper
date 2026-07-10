import { NextRequest } from "next/server";
import { errorResponse, jsonResponse } from "@/lib/utils";
import { runWorkerTick } from "@/services/workerService";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorizeWorker(request: NextRequest): boolean {
  const secret =
    process.env.WORKER_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Allow in development without a secret; require one in production.
    return process.env.NODE_ENV !== "production";
  }
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const query = request.nextUrl.searchParams.get("secret");
  return bearer === secret || query === secret;
}

export async function POST(request: NextRequest) {
  try {
    if (!authorizeWorker(request)) {
      return errorResponse("Unauthorized", 401);
    }
    const result = await runWorkerTick();
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker tick failed";
    return errorResponse(message, 500);
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
