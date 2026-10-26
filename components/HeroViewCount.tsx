"use client";

import { useEffect, useState } from "react";
import { formatViewCount, type PublicImpact } from "@/lib/publicLanding";

export function HeroViewCount({ initialImpact }: { initialImpact: PublicImpact }) {
  const [impact, setImpact] = useState(initialImpact);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/public/landing", { signal: controller.signal, cache: "no-store" });
        if (response.ok) setImpact((await response.json()).impact);
      } catch { /* Keep the last snapshot during a temporary outage. */ }
    };
    const timer = setInterval(() => void refresh(), 60 * 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const updated = impact.refreshedAt ? `Last updated ${new Date(impact.refreshedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} UTC.` : "The first daily account refresh is pending.";
  return <div className="text-sm text-white/65" title={`${updated} Total views reported by connected accounts with analytics access. Unavailable counts are excluded.`}>
    <p>Views produced with Stream Clipper: <span className="font-semibold tabular-nums text-[var(--color-accent)]">{impact.totalViews !== null ? formatViewCount(impact.totalViews) : "—"}</span></p>
    <p className="mt-1 text-xs text-[var(--color-muted)]">Updated daily</p>
  </div>;
}
