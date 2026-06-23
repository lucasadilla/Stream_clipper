import { NextRequest } from "next/server";
import { z } from "zod";
import { createStreamSession } from "@/services/youtubeService";
import { errorResponse, jsonResponse } from "@/lib/utils";

const createSessionSchema = z.object({
  youtubeUrl: z.string().url("Please enter a valid URL"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { youtubeUrl } = createSessionSchema.parse(body);
    const session = await createStreamSession(youtubeUrl);
    return jsonResponse({ session }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid input", 400);
    }
    const message = error instanceof Error ? error.message : "Failed to create session";
    return errorResponse(message, 500);
  }
}
