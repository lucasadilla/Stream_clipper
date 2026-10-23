import { z } from "zod";
import type { SocialGeneratedContent } from "./types";

export const reviewSelectionSchema = z.object({
  jobs: z.array(z.object({ id: z.string().min(1).max(100), version: z.string().datetime(), tiktokConsent: z.boolean().optional() })).min(1).max(30),
  scheduledFor: z.string().datetime().optional(),
}).refine((input) => new Set(input.jobs.map((job) => job.id)).size === input.jobs.length, "Select each post once");
export function futureSchedule(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now() + 15_000 || date.getTime() > Date.now() + 366 * 86400000) throw new Error("Choose a time at least 15 seconds ahead, within the next year.");
  return date;
}
export function calendarRange(from: string | null, to: string | null) {
  const start = new Date(from || ""), end = new Date(to || "");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 93 * 86400000) throw new Error("Choose a calendar range of up to 93 days.");
  return { start, end };
}
export interface PublishingPost {
  id: string; groupId: string; clipId: string; clipTitle: string; platform: string;
  status: string; version: string; accountId: string; accountName: string;
  title: string; caption: string; settings: Record<string, unknown>; scheduledFor: string | null;
  completedAt: string | null; createdAt: string; previewUrl: string | null; postUrl: string | null;
  error: string | null;
  content: SocialGeneratedContent;
}
export function localDateTimeValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
