"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, ArrowRight, Check, Play, Scissors } from "lucide-react";
import { formatViewCount, type PublicImpact, type PublicShowcaseClip } from "@/lib/publicLanding";
import styles from "./LandingShowcase.module.css";

function DemoArtwork({ variant = 0 }: { variant?: number }) {
  return <div className={`${styles.artwork} ${styles[`art${variant}`]}`} aria-hidden="true">
    <div className={styles.window}><i /><i /><i /><span>CLIPPER / STUDIO</span></div>
    <div className={styles.landscape}><div className={styles.sun} /><div className={styles.hill} /><div className={styles.hillTwo} /><div className={styles.person}><i /><b /></div><div className={styles.focus}><i /><span>Subject in focus</span></div></div>
    <div className={styles.waveform}>{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ height: `${12 + ((i * 17) % 26)}px` }} />)}</div>
  </div>;
}

export function LandingShowcase({ initialImpact, initialClips }: { initialImpact: PublicImpact; initialClips: PublicShowcaseClip[] }) {
  const [impact, setImpact] = useState(initialImpact), [clips, setClips] = useState(initialClips);
  const [category, setCategory] = useState("all"), [sourceGroup, setSourceGroup] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/public/landing", { signal: controller.signal, cache: "no-store" });
        if (response.ok) { const data = await response.json(); setImpact(data.impact); setClips(data.clips); }
      } catch { /* Keep the server-rendered snapshot on a temporary outage. */ }
    };
    const timer = setInterval(() => void refresh(), 60 * 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const filtered = clips.filter(clip => category === "all" || clip.category === category);
  const active = filtered.find(clip => clip.sourceGroup === sourceGroup) ?? filtered[0];
  const siblings = active ? filtered.filter(clip => clip.sourceGroup === active.sourceGroup) : [];
  const source = siblings.find(clip => clip.sourceVideoUrl || clip.sourcePosterUrl);
  const cards = siblings.slice(0, 3);
  function pauseOthers(event: React.SyntheticEvent<HTMLVideoElement>) {
    root.current?.querySelectorAll("video").forEach(video => { if (video !== event.currentTarget) video.pause(); });
  }
  return <section ref={root} id="made-with-clipper" className={styles.section} aria-labelledby="showcase-heading">
    <div className={styles.inner}>
      <div className={styles.impact}>
        <div><p className={styles.eyebrow}><span className={styles.dot} />Made with Clipper. Watched everywhere.</p>
          <div className={styles.counter}>{impact.totalViews !== null ? formatViewCount(impact.totalViews) : "Every moment starts somewhere."}<span>{impact.totalViews !== null ? "recorded views" : "Your next clip could be the one."}</span></div>
        </div>
        <div className={styles.metricNote}>
          <p>Views on clips published through Clipper.</p>
          <p>Available platform counts, refreshed daily.</p>
          {impact.refreshedAt ? <p><Check size={12} />Last update <time dateTime={impact.refreshedAt}>{new Date(impact.refreshedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} UTC</time></p> : <p>First verified counts will appear here.</p>}
          {impact.totalViews !== null && <p className={styles.finePrint}>Not unique viewers. Unavailable counts are excluded.</p>}
        </div>
      </div>
      <div className={styles.heading}>
        <div><p className={styles.eyebrow}>One video. More moments.</p><h2 id="showcase-heading">Go wide.<br /><em>Then go everywhere.</em></h2></div>
        <p>The full story becomes the moments worth sharing. Your framing, captions, and finished clips — ready for the feed.</p>
      </div>
      {clips.length > 0 && <div className={styles.filters} aria-label="Showcase categories">{["all", "gaming", "podcast", "irl", "other"].filter(value => value === "all" || clips.some(clip => clip.category === value)).map(value => <button key={value} aria-pressed={category === value} onClick={() => { setCategory(value); setSourceGroup(null); }}>{value === "all" ? "All moments" : value === "irl" ? "IRL" : value}</button>)}</div>}
      <div className={styles.transformation}>
        <div className={styles.sourceColumn}>
          <div className={styles.frameLabel}><span>01 / THE ORIGINAL</span><span>16:9</span></div>
          <div className={styles.sourceFrame}>
            {source?.sourceVideoUrl ? <video key={source.id} controls playsInline preload="none" poster={source.sourcePosterUrl ?? undefined} src={source.sourceVideoUrl} onPlay={pauseOthers} aria-label={`Original source excerpt: ${active?.sourceTitle}`} /> : source?.sourcePosterUrl ? <Image unoptimized width={1280} height={720} src={source.sourcePosterUrl} alt={`Source moment from ${active?.sourceTitle}`} /> : <DemoArtwork />}
            {!source && <span className={styles.demoTag}>Layout demonstration</span>}
          </div>
          <div className={styles.sourceMeta}><span><Scissors size={17} />{active?.sourceTitle ?? "Your stream. Your podcast. Your story."}</span><span>{active ? "Source excerpt" : "Find the moments that matter"}</span></div>
          <div className={styles.timeline}><span>00:00</span><div>{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ height: `${8 + (i * 13 % 25)}px` }} />)}<b /><b /><b /></div><span>→</span></div>
        </div>
        <div className={styles.connector} aria-hidden="true"><span /><Scissors size={22} /><ArrowRight className={styles.desktopArrow} size={25} /><ArrowDown className={styles.mobileArrow} size={25} /></div>
        <div className={styles.shortsColumn}>
          <div className={styles.frameLabel}><span>02 / READY FOR THE FEED</span><span>9:16</span></div>
          <div className={styles.shorts} data-count={cards.length || 3}>
            {cards.length ? cards.map((clip, index) => <article key={clip.id} className={styles.shortCard}>
              <div className={styles.shortFrame}><video controls playsInline preload="none" poster={clip.posterUrl} src={clip.videoUrl} onPlay={pauseOthers} aria-label={`Clipper short: ${clip.title}`} /><span className={styles.clipNumber}>0{index + 1}</span></div>
              <h3>{clip.title}</h3><p>{clip.creatorName}</p><span className={styles.clipDetail}>{clip.views !== null ? `${formatViewCount(clip.views)} views · ` : ""}{Math.round(clip.durationSeconds)}s · {clip.platform === "youtube" ? "YouTube Shorts" : clip.platform}</span>
            </article>) : ["Find the hook.", "Keep the context.", "Make it yours."].map((title, index) => <article key={title} className={`${styles.shortCard} ${styles.demoCard}`}>
              <div className={styles.shortFrame}><DemoArtwork variant={index + 1} /><span className={styles.clipNumber}>0{index + 1}</span><div className={styles.caption}>{title.split(" ").map((word, i) => <span key={i}>{word} </span>)}</div><span className={styles.demoPlay} aria-hidden="true"><Play fill="currentColor" size={16} /></span></div><h3>{["Gaming", "Podcasts", "IRL & more"][index]}</h3><p>Illustrated layout example</p>
            </article>)}
          </div>
          {active && cards.length < 3 && <p className={styles.finePrint}>Showing {cards.length} approved {cards.length === 1 ? "short" : "shorts"} from this source.</p>}
        </div>
      </div>
      {filtered.some(clip => clip.sourceGroup !== active?.sourceGroup) && <div className={styles.sources} aria-label="Choose a source video">{filtered.filter((clip, i, all) => all.findIndex(other => other.sourceGroup === clip.sourceGroup) === i).map(clip => <button key={clip.sourceGroup} aria-pressed={active?.sourceGroup === clip.sourceGroup} onClick={() => setSourceGroup(clip.sourceGroup)}>{clip.category === "irl" ? "IRL" : clip.category}<span>{clip.creatorName}</span><ArrowUpRight size={14} /></button>)}</div>}
      <div className={styles.footer}><p>{clips.length ? "Real clips. Shared with creator permission." : "Real creator clips will appear here after approval."}</p><Link href="/#analyze">Make your first clip <ArrowUpRight size={17} /></Link><Link className={styles.submitLink} href="/settings/showcase">Get featured</Link></div>
    </div>
  </section>;
}
