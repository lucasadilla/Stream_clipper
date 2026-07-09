"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

interface RuntimeHealth {
  ok?: boolean;
  ffmpeg?: boolean;
  ytDlp?: boolean;
  aiConfigured?: boolean;
  whisperConfigured?: boolean;
  storageRoot?: string;
  storageWritable?: boolean;
  nodeEnv?: string;
  issues?: string[];
  error?: string;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border px-4 py-3 text-sm",
        ok
          ? "border-[var(--color-accent)]/30 bg-[#071007] text-white"
          : "border-[var(--color-danger)]/30 bg-[#140808] text-white"
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "text-xs font-semibold uppercase",
          ok ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"
        )}
      >
        {ok ? "OK" : "Missing"}
      </span>
    </div>
  );
}

export default function HealthPage() {
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchJson<RuntimeHealth>("/api/health")
      .then(({ ok, data }) => {
        if (!ok && data.error) {
          setLoadError(data.error);
        }
        setHealth(data);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load health");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="border-b border-[var(--color-card-border)] bg-[#020302]">
      <div className="mx-auto max-w-[960px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
        <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
          Deployment / runtime
        </p>
        <h1 className="marketing-display-title mt-4 font-semibold text-white">
          Server health
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-muted)] sm:text-base">
          This page checks whether Railway can transcribe and render. The raw API
          is at{" "}
          <Link href="/api/health" className="text-[var(--color-accent)]">
            /api/health
          </Link>
          .
        </p>

        <div className="mt-8 border border-[var(--color-card-border)] bg-[#050805] p-6 sm:p-8">
          {loading && (
            <p className="text-sm text-[var(--color-muted)] animate-pulse">
              Checking server...
            </p>
          )}

          {loadError && (
            <p className="text-sm text-[var(--color-danger)]">{loadError}</p>
          )}

          {health && (
            <div className="space-y-6">
              <div
                className={cn(
                  "inline-flex items-center gap-2 border px-3 py-2 text-xs font-semibold uppercase",
                  health.ok
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-danger)] text-[var(--color-danger)]"
                )}
              >
                {health.ok ? "Ready" : "Needs setup"}
              </div>

              <div className="grid gap-2">
                <StatusPill ok={Boolean(health.ffmpeg)} label="FFmpeg" />
                <StatusPill ok={Boolean(health.ytDlp)} label="yt-dlp" />
                <StatusPill
                  ok={Boolean(health.aiConfigured)}
                  label="AI API key"
                />
                <StatusPill
                  ok={Boolean(health.whisperConfigured)}
                  label="Whisper provider"
                />
                <StatusPill
                  ok={Boolean(health.storageWritable)}
                  label="Writable storage"
                />
              </div>

              {health.storageRoot && (
                <p className="text-xs text-[var(--color-muted)]">
                  Storage root: <code className="text-white/80">{health.storageRoot}</code>
                </p>
              )}

              {health.issues && health.issues.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-[var(--color-muted)]">
                    Fix these on Railway
                  </p>
                  <ul className="space-y-2 text-sm leading-6 text-white/80">
                    {health.issues.map((issue) => (
                      <li
                        key={issue}
                        className="border-l-2 border-[var(--color-danger)] pl-3"
                      >
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="mt-6 text-xs leading-6 text-[var(--color-muted)]">
          Console warnings from <code>contentscript.js</code> usually come from a
          browser extension (wallet, Grammarly, etc.), not this app.
        </p>
      </div>
    </section>
  );
}
