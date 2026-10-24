"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Play, X } from "lucide-react";
import { formatShortViews, HERO_YOUTUBE_CHANNEL, sampleShort, type FeaturedShort } from "@/lib/heroShorts";
import { VideoComparison } from "@/components/VideoComparison";
import styles from "./HeroShorts.module.css";

export function HeroShorts({ shorts }: { shorts: FeaturedShort[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [comparison, setComparison] = useState<FeaturedShort | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/landing/editor?access=1", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (response.ok) setCanEdit((await response.json()).canEdit === true); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setActive(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [active]);

  return <div className={styles.wrap} aria-label="Shorts from StreamClipperAdmin">
    <div className={styles.videos}>
      {shorts.map(short => <div key={short.id}>
        <div className={styles.video}>
        {active === short.id ? <>
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${short.id}?autoplay=1&playsinline=1&rel=0`}
            title={short.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
          <button className={styles.close} onClick={() => setActive(null)} aria-label="Close video"><X size={14} /></button>
        </> : <button className={styles.poster} onClick={() => setActive(short.id)} aria-label={`Play ${short.title}`}>
          <Image unoptimized width={405} height={720} src={short.poster} alt={short.title} />
          <span className={styles.play}><Play size={18} fill="currentColor" strokeWidth={1.5} /></span>
        </button>}
        </div>
        <p className={styles.views} title={short.refreshedAt ? `Updated ${new Date(short.refreshedAt).toLocaleDateString("en-US", { timeZone: "UTC" })}` : "Awaiting daily YouTube statistics"}>
          {short.views !== null ? formatShortViews(short.views) : "— views"}
        </p>
      </div>)}
    </div>
    <div className={styles.links}>
      <a className={styles.channel} href={HERO_YOUTUBE_CHANNEL} target="_blank" rel="noopener noreferrer">@StreamClipperAdmin ↗</a>
      <button className={styles.channel} onClick={() => { setActive(null); setComparison(shorts.find(short => short.source) ?? sampleShort()); }}>Original → Short</button>
      {canEdit && <a className={styles.channel} href="/settings/landing">Manage featured clips</a>}
    </div>
    {comparison && <VideoComparison short={comparison} onClose={() => setComparison(null)} />}
  </div>;
}
