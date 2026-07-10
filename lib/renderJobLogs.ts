import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type RenderJobLogLevel = "info" | "warn" | "error";

export interface RenderJobLogEntry {
  at: string;
  level: RenderJobLogLevel;
  step: string;
  message: string;
}

const MAX_LOG_ENTRIES = 80;

export function makeRenderJobLogEntry(
  step: string,
  message: string,
  level: RenderJobLogLevel = "info"
): RenderJobLogEntry {
  return {
    at: new Date().toISOString(),
    level,
    step,
    message: message.slice(0, 2000),
  };
}

export function parseRenderJobLogs(value: unknown): RenderJobLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is RenderJobLogEntry => {
      if (!entry || typeof entry !== "object") return false;
      const raw = entry as Record<string, unknown>;
      return (
        typeof raw.at === "string" &&
        typeof raw.step === "string" &&
        typeof raw.message === "string" &&
        (raw.level === "info" || raw.level === "warn" || raw.level === "error")
      );
    })
    .slice(-MAX_LOG_ENTRIES);
}

export async function appendRenderJobLog(
  jobId: string,
  step: string,
  message: string,
  level: RenderJobLogLevel = "info"
): Promise<void> {
  const job = await prisma.renderJob.findUnique({
    where: { id: jobId },
    select: { logs: true },
  });
  if (!job) return;

  const logs = [
    ...parseRenderJobLogs(job.logs),
    makeRenderJobLogEntry(step, message, level),
  ].slice(-MAX_LOG_ENTRIES);

  await prisma.renderJob.update({
    where: { id: jobId },
    data: { logs: logs as unknown as Prisma.InputJsonValue },
  });
}
