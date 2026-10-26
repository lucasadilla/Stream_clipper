"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { FeaturedShort } from "@/lib/heroShorts";
import styles from "./HeroShorts.module.css";

export function VideoComparison({ short, onClose }: { short: FeaturedShort; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<"original" | "short">("original");
  useEffect(() => {
    const element = dialog.current;
    const focused = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); focused?.focus(); };
  }, []);
  if (!short.source) return null;
  const id = format === "original" ? short.source.videoId : short.id;
  const start = format === "original" ? short.source.startSeconds : 0;
  const end = format === "original" ? short.source.endSeconds : short.durationSeconds;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="comparison-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className={styles.dialogBody}>
      <div className={styles.dialogHeader}>
        <h2 id="comparison-title">From the original to a Short</h2>
        <button aria-label="Close comparison" onClick={onClose}><X size={20} /></button>
      </div>
      <div className={styles.toggle} role="group" aria-label="Video format">
        <button autoFocus aria-pressed={format === "original"} onClick={() => setFormat("original")}>Original · 16:9</button>
        <span aria-hidden="true">→</span>
        <button aria-pressed={format === "short"} onClick={() => setFormat("short")}>Clipper Short · 9:16</button>
      </div>
      <div className={`${styles.compareStage} ${format === "short" ? styles.vertical : ""}`}>
        <iframe key={format} src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&start=${Math.floor(start)}${end ? `&end=${Math.ceil(end)}` : ""}`}
          title={`${format === "original" ? "Original" : "Short"}: ${short.title}`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
      </div>
      <p className={styles.note}>Switch formats to see the same moment in its original frame and finished vertical layout.</p>
      <a className={styles.channel} href="/sample">Try the prepared sample →</a>
    </div>
  </dialog>;
}
