"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LAST_SESSION_KEY } from "@/components/RememberSession";

export function LandingQuickLinks() {
  const [session, setSession] = useState<{ id: string; title: string | null } | null>(null);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      let last = "";
      try { last = localStorage.getItem(LAST_SESSION_KEY) ?? ""; } catch { /* Optional hint only. */ }
      try {
        const response = await fetch(`/api/sessions/recent?last=${encodeURIComponent(last)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (!disposed) setSession(data.session ?? null);
      } catch { /* Landing page remains usable if the workspace is unavailable. */ }
    };
    void load();
    document.addEventListener("visibilitychange", load);
    return () => { disposed = true; controller.abort(); document.removeEventListener("visibilitychange", load); };
  }, []);
  return <div className="mt-3 flex min-h-5 flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--color-muted)]">
    <Link href="/sample" className="hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]">Try a sample ↗</Link>
    {session && <Link href={`/sessions/${encodeURIComponent(session.id)}`} title={session.title ?? "Your last session"} className="max-w-full truncate text-[var(--color-accent)] hover:underline">Continue your last session →</Link>}
  </div>;
}
