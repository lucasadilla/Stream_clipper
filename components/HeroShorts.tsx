"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Play, X } from "lucide-react";
import { HERO_SHORTS, HERO_YOUTUBE_CHANNEL } from "@/lib/heroShorts";
import styles from "./HeroShorts.module.css";

export function HeroShorts() {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setActive(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [active]);

  return <div className={styles.wrap} aria-label="Shorts from StreamClipperAdmin">
    <div className={styles.videos}>
      {HERO_SHORTS.map(short => <div key={short.id} className={styles.video}>
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
      </div>)}
    </div>
    <a className={styles.channel} href={HERO_YOUTUBE_CHANNEL} target="_blank" rel="noopener noreferrer">@StreamClipperAdmin ↗</a>
  </div>;
}
