import { z } from "zod";

const videoId = z.string().regex(/^[a-zA-Z0-9_-]{11}$/, "Enter a YouTube video ID (11 characters).");
const source = z.object({ videoId, startSeconds: z.number().finite().min(0).max(86400), endSeconds: z.number().finite().min(1).max(86580) })
  .refine(value => value.endSeconds > value.startSeconds && value.endSeconds - value.startSeconds <= 180, "Select up to three minutes of the original video.");
export const landingEditorInput = z.union([
  z.object({ pins: z.array(videoId.nullable()).length(3) }).strict().refine(value => {
    const ids = value.pins.filter(Boolean); return new Set(ids).size === ids.length;
  }, "Choose a different video for each pinned position."),
  z.object({ id: videoId, eligible: z.boolean().optional(), source: source.nullable().optional() }).strict()
    .refine(value => value.eligible !== undefined || value.source !== undefined, "Choose a change to save."),
]);

export function sameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin && request.headers.get("content-type")?.includes("application/json"));
}
