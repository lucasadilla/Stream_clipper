"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountSettingsShell, AccountSettingsPanel } from "@/components/account/AccountSettingsShell";
import { formatShortViews } from "@/lib/heroShorts";
import { fetchJson } from "@/lib/apiClient";

interface Video { id: string; title: string; views: string | null; eligible: boolean; available: boolean; pinSlot: number | null; sourceVideoId: string | null; sourceStartSeconds: number | null; sourceEndSeconds: number | null }
export function LandingFeaturedEditor() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [pins, setPins] = useState<Array<string | null>>([null, null, null]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [allowed, setAllowed] = useState(false);
  async function load() {
    const result = await fetchJson<{ videos?: Video[]; error?: string }>("/api/landing/editor", { cache: "no-store" });
    if (!result.ok) { setAllowed(false); throw new Error(result.data.error ?? "Could not load featured clips."); }
    const rows = result.data.videos ?? [];
    setAllowed(true); setVideos(rows); setPins([0, 1, 2].map(slot => rows.find(row => row.pinSlot === slot)?.id ?? null));
  }
  useEffect(() => { let cancelled = false; void load().catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setBusy(false); }); return () => { cancelled = true; }; }, []);
  async function save(body: unknown, method = "PATCH") {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await fetchJson<{ error?: string; message?: string }>("/api/landing/editor", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!result.ok) throw new Error(result.data.error ?? "Could not save changes.");
      setMessage(result.data.message ?? "Featured clips saved."); await load();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save changes."); }
    finally { setBusy(false); }
  }
  return <AccountSettingsShell title="Featured clips" description="Choose the Shorts visitors see on the landing page. Unpinned positions refresh automatically with a recent Short and top performers." error={error} message={message} wide>
    {!allowed ? <p className="mt-8 text-sm text-[var(--color-muted)]">{busy ? "Loading your channel…" : <><Link className="text-[var(--color-accent)] hover:underline" href="/settings/connected-accounts">Connect @StreamClipperAdmin</Link> to manage its public featured clips.</>}</p> : <div className="mt-8 space-y-6">
      <AccountSettingsPanel title="Pinned positions">
        <div className="grid gap-4 sm:grid-cols-3">{pins.map((id, index) => <label key={index} className="min-w-0 text-xs text-[var(--color-muted)]">Position {index + 1}
          <select aria-label={`Pinned position ${index + 1}`} disabled={busy} className="mt-2 w-full border border-[var(--color-card-border)] bg-[#020302] p-3 text-sm text-white" value={id ?? ""} onChange={event => setPins(current => current.map((value, slot) => slot === index ? event.target.value || null : value))}>
            <option value="">Automatic</option>{videos.filter(video => video.available && video.eligible).map(video => <option key={video.id} value={video.id}>{video.title}</option>)}
          </select></label>)}</div>
        <div className="mt-5 flex flex-wrap gap-4 text-xs"><button disabled={busy} className="bg-[var(--color-accent)] px-4 py-3 font-semibold text-[#071006] disabled:opacity-50" onClick={() => save({ pins })}>{busy ? "Working…" : "Save pins"}</button>
          <button disabled={busy} className="border border-[var(--color-card-border)] px-4 py-3 disabled:opacity-50" onClick={() => save({}, "POST")}>Refresh channel videos</button><Link className="self-center text-[var(--color-muted)] hover:text-white" href="/">View landing page ↗</Link></div>
      </AccountSettingsPanel>
      <AccountSettingsPanel title="Channel Shorts">
        <p className="mb-5 text-xs leading-6 text-[var(--color-muted)]">Public, embeddable Shorts only. New vertical clips published through Clipper and uploads tagged #shorts are eligible automatically. Confirm other short uploads here. Counts refresh daily; pins stay in place.</p>
        {!videos.length && <p className="text-sm">No cached videos yet. Refresh channel videos to load your public uploads.</p>}
        <div className="divide-y divide-[var(--color-card-border)]">{videos.map(video => <div key={video.id} className="py-5">
          <div className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><a className="text-sm hover:text-[var(--color-accent)]" href={`https://www.youtube.com/shorts/${video.id}`} target="_blank" rel="noopener noreferrer">{video.title} ↗</a><p className="mt-2 text-xs text-[var(--color-muted)]">{video.views === null ? "Views unavailable" : formatShortViews(video.views)}{!video.available && " · Not publicly embeddable"}</p></div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={busy || !video.available} checked={video.eligible} onChange={event => save({ id: video.id, eligible: event.target.checked })} className="accent-[var(--color-accent)]" />Allow in automatic picks</label></div>
          <details className="mt-4 text-xs text-[var(--color-muted)]"><summary className="cursor-pointer">Original video comparison</summary>
            <form className="mt-4 grid gap-3 sm:grid-cols-4" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const videoId = String(data.get("videoId") ?? "").trim(); void save({ id: video.id, source: videoId ? { videoId, startSeconds: Number(data.get("start")), endSeconds: Number(data.get("end")) } : null }); }}>
              <label>YouTube video ID<input name="videoId" defaultValue={video.sourceVideoId ?? ""} maxLength={11} className="mt-2 w-full border border-[var(--color-card-border)] bg-[#020302] p-2 text-white" /></label>
              <label>Start (seconds)<input name="start" type="number" min="0" step="1" defaultValue={video.sourceStartSeconds ?? 0} className="mt-2 w-full border border-[var(--color-card-border)] bg-[#020302] p-2 text-white" /></label>
              <label>End (seconds)<input name="end" type="number" min="1" step="1" defaultValue={video.sourceEndSeconds ?? 70} className="mt-2 w-full border border-[var(--color-card-border)] bg-[#020302] p-2 text-white" /></label>
              <button disabled={busy} type="submit" className="self-end border border-[var(--color-card-border)] p-2 hover:text-white disabled:opacity-50">Save source</button>
            </form><p className="mt-3 leading-5">Use the actual 16:9 source and the matching moment (up to 180 seconds). Clear the ID to remove the comparison.</p>
          </details>
        </div>)}</div>
      </AccountSettingsPanel>
    </div>}
  </AccountSettingsShell>;
}
