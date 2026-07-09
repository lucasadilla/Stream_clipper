import { existsSync } from "fs";
import path from "path";

const LINUX_CANDIDATES = [
  "/usr/local/bin/yt-dlp",
  "/usr/bin/yt-dlp",
  "yt-dlp",
];

export interface YtDlpInvocation {
  command: string;
  prefixArgs: string[];
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.includes("\\");
}

function configuredYtDlpPath(): string | null {
  const configured = process.env.YT_DLP_PATH?.trim();
  if (!configured) return null;

  if (process.platform !== "win32" && isWindowsAbsolutePath(configured)) {
    return null;
  }

  if (path.isAbsolute(configured) && !existsSync(configured)) {
    return null;
  }

  return configured;
}

export function formatYtDlpInvocation(invocation: YtDlpInvocation): string {
  return invocation.prefixArgs.length > 0
    ? `${invocation.command} ${invocation.prefixArgs.join(" ")}`
    : invocation.command;
}

export function getYtDlpInvocationCandidates(): YtDlpInvocation[] {
  const seen = new Set<string>();
  const candidates: YtDlpInvocation[] = [];

  function add(command: string, prefixArgs: string[] = []) {
    const key = `${command}\0${prefixArgs.join("\0")}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ command, prefixArgs });
  }

  const configured = configuredYtDlpPath();
  if (configured) add(configured);

  if (process.platform !== "win32") {
    for (const candidate of LINUX_CANDIDATES) {
      if (candidate === "yt-dlp" || existsSync(candidate)) {
        add(candidate);
      }
    }
    add("python3", ["-m", "yt_dlp"]);
  } else {
    add("yt-dlp");
  }

  return candidates;
}

/** Resolve yt-dlp binary, ignoring invalid Windows paths on Linux deploys. */
export function getYtDlpPath(): string {
  return getYtDlpInvocationCandidates()[0]?.command ?? "yt-dlp";
}

export function getYtDlpPathCandidates(): string[] {
  return getYtDlpInvocationCandidates().map(formatYtDlpInvocation);
}
