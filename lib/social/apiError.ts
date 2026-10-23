import { z } from "zod";
import { jsonResponse } from "@/lib/utils";
import { SessionAccessError } from "@/services/social/socialAccessService";
import { safePublishError } from "./publishingPolicy";
export function socialApiError(error: unknown) {
  if (error instanceof SessionAccessError) return jsonResponse({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return jsonResponse({ error: error.issues[0]?.message || "Invalid request" }, 400);
  return jsonResponse({ error: safePublishError(error instanceof Error ? error.message : "Request failed") }, 400);
}
