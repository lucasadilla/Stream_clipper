import { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, jsonResponse, parseRequestJson } from "@/lib/utils";
import { registerWithPassword } from "@/services/passwordAuthService";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().max(80).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseRequestJson(request);
    if (!body) return errorResponse("Request body required", 400);
    const parsed = schema.parse(body);
    const user = await registerWithPassword(parsed);
    return jsonResponse({ ok: true, user: { email: user.email } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message =
      error instanceof Error ? error.message : "Could not create account";
    return errorResponse(message, 400);
  }
}
