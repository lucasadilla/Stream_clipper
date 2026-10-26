import { z } from "zod";
export const LIBRARY_TRASH_DAYS = 30;
export const LIVE_POST_STATUSES = ["scheduled", "queued", "preparing_media", "uploading", "processing", "publishing", "outcome_unknown"];
export const libraryEditSchema = z.object({
  title: z.string().trim().min(1).max(200),
  postingCaption: z.string().max(10000).nullable(),
}).strict();
export function libraryStatus(posts: Array<{ status: string }>, ready: boolean): string {
  if (posts.some(post => ["queued", "preparing_media", "uploading", "processing", "publishing"].includes(post.status))) return "publishing";
  if (posts.some(post => post.status === "scheduled")) return "scheduled";
  if (posts.some(post => ["failed", "outcome_unknown"].includes(post.status))) return "failed";
  if (posts.some(post => post.status === "completed")) return "published";
  return ready ? "draft" : "unavailable";
}
export function sameOriginLibraryWrite(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin && Boolean(request.headers.get("content-type")?.includes("application/json"));
}
export function isLibraryPath(value: string): boolean { return value.replace(/\\/g, "/").startsWith("library/"); }
