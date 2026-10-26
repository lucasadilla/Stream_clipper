"use client";
import Link from "next/link";
import { useState } from "react";
import { sampleShort } from "@/lib/heroShorts";
import { SAMPLE_DURATION, sampleRange, sampleTimestamp } from "@/lib/sampleTimeline";
import { VideoComparison } from "@/components/VideoComparison";
import styles from "./SampleWorkspace.module.css";

const short = sampleShort();
const PRESETS = [{ name: "Full moment", start: 0, end: 70 }, { name: "Opening", start: 0, end: 20 }, { name: "Middle", start: 20, end: 45 }, { name: "Ending", start: 45, end: 70 }];
export function SampleWorkspace() {
  const [range, setRange] = useState({ start: 0, end: SAMPLE_DURATION });
  const [play, setPlay] = useState<{ start: number; end: number; revision: number } | null>(null);
  const [compare, setCompare] = useState(false);
  const select = (start: number, end: number) => { setPlay(null); setRange(sampleRange(start, end)); };
  return <div className={styles.workspace}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Clipper / prepared sample</p><h1>Find the moment. Make the cut.</h1>
        <p>Try a real clip from @StreamClipperAdmin. No sign-in or processing wait.</p></div>
      <Link href="/#analyze" className={styles.primary}>Use your own video →</Link>
    </header>
    <div className={styles.editor}>
      <div className={styles.stage}>
        {play ? <iframe key={play.revision} src={`https://www.youtube-nocookie.com/embed/${short.id}?autoplay=1&playsinline=1&rel=0&start=${play.start}&end=${play.end}`}
          title="Selected sample clip" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
          : <button className={styles.poster} onClick={() => setPlay({ ...range, revision: Date.now() })} aria-label="Play sample selection">
            {/* Original YouTube portrait thumbnail; no video processing runs in this sample. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={short.poster} alt={short.title} /><span>Play selection ▶</span>
          </button>}
      </div>
      <div className={styles.controls}>
        <p className={styles.eyebrow}>01 / Pick a range</p><h2>A short moment, ready to explore.</h2>
        <p>Move the handles, or jump to a prepared section. Preview plays only your selected range.</p>
        <div className={styles.presets}>{PRESETS.map(preset => <button key={preset.name} aria-pressed={range.start === preset.start && range.end === preset.end} onClick={() => select(preset.start, preset.end)}>{preset.name}</button>)}</div>
        <div className={styles.selection} aria-hidden="true"><span style={{ left: `${range.start / SAMPLE_DURATION * 100}%`, width: `${(range.end - range.start) / SAMPLE_DURATION * 100}%` }} /></div>
        <label>Start <output>{sampleTimestamp(range.start)}</output><input type="range" aria-label="Selection start" min="0" max={SAMPLE_DURATION - 1} step="1" value={range.start} onChange={event => select(Number(event.target.value), range.end)} /></label>
        <label>End <output>{sampleTimestamp(range.end)}</output><input type="range" aria-label="Selection end" min={range.start + 1} max={SAMPLE_DURATION} step="1" value={range.end} onChange={event => select(range.start, Number(event.target.value))} /></label>
        <div className={styles.actions}><button className={styles.primary} onClick={() => setPlay({ ...range, revision: Date.now() })}>Preview {range.end - range.start}s selection</button>
          <button onClick={() => { setPlay(null); setCompare(true); }}>Original → Short</button>
          <button onClick={() => select(0, SAMPLE_DURATION)}>Reset</button></div>
        <p className={styles.eyebrow}>02 / See the finished result</p>
        <p>The finished Short includes its vertical framing and burned-in captions. Compare it with the original 16:9 interview.</p>
        <p className={styles.note}>This sample previews an already published clip. Upload your own video to edit captions, render, download, or publish. Your saved workspace is untouched.</p>
        <a className={styles.source} href={`https://www.youtube.com/shorts/${short.id}`} target="_blank" rel="noopener noreferrer">Watch the featured Short on YouTube ↗</a>
      </div>
    </div>
    {compare && <VideoComparison short={short} onClose={() => setCompare(false)} />}
  </div>;
}
