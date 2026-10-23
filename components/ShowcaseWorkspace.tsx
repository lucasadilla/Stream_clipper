"use client";
import { useCallback, useEffect, useState } from "react";
import { AccountSettingsShell } from "@/components/account/AccountSettingsShell";

interface Submission { id: string; platformExportId: string; title: string; creatorName: string; sourceTitle: string; status: string; consentAt: string | null; hasSourceVideo: boolean }
interface FinishedExport { id: string; title: string | null; platform: string }
const field = "w-full rounded border border-white/20 bg-[#050805] p-3 text-sm text-white";
const button = "rounded border border-lime-300/40 px-4 py-2 text-sm text-lime-200 disabled:opacity-40";
export function ShowcaseWorkspace() {
  const [rows, setRows] = useState<Submission[]>([]), [exports, setExports] = useState<FinishedExport[]>([]);
  const [canReview, setCanReview] = useState(false), [review, setReview] = useState(false);
  const [exportId, setExportId] = useState(""), [title, setTitle] = useState(""), [creatorName, setCreatorName] = useState(""), [category, setCategory] = useState("gaming"), [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/social/showcase${review ? "?review=1" : ""}`, { cache: "no-store", signal });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load showcase.");
    setRows(data.submissions); setExports(data.exports); setCanReview(data.canReview);
  }, [review]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    void load(controller.signal).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);
  async function save(method: string, body: unknown) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/social/showcase", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save showcase.");
      setConsent(false); await load(); setMessage(method === "POST" ? "Submitted for review. Your clip stays private until approved." : "Showcase updated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save showcase."); }
    finally { setBusy(false); }
  }
  const available = exports.filter(item => !rows.some(row => row.platformExportId === item.id));
  return <AccountSettingsShell wide title="Made with Clipper" description="Choose the clips you want to share on Clipper’s public landing page. Every clip needs your permission and owner approval." message={message} error={error}>
    {canReview && <div className="mt-6 flex gap-3"><button className={button} disabled={busy} aria-pressed={!review} onClick={() => setReview(false)}>My submissions</button><button className={button} disabled={busy} aria-pressed={review} onClick={() => setReview(true)}>Review showcase</button></div>}
    {!review && <form className="mt-8 grid gap-5 rounded-xl border border-white/15 p-5 sm:p-7" onSubmit={event => { event.preventDefault(); void save("POST", { exportId, title, creatorName, category, consent }); }}>
      <h2 className="text-xl font-semibold text-white">Submit a finished short</h2>
      <p className="text-sm leading-6 text-white/60">Choose a vertical export under two minutes. We keep a showcase copy of the finished clip and, when available, its widescreen source excerpt. Your private sessions and other clips stay private.</p>
      <label className="text-sm text-white/80">Finished export<select required disabled={busy || loading} value={exportId} className={`${field} mt-2`} onChange={event => { setExportId(event.target.value); setTitle(available.find(item => item.id === event.target.value)?.title || ""); setConsent(false); }}><option value="">Choose a finished export</option>{available.map(item => <option key={item.id} value={item.id}>{item.title || "Untitled clip"} · {item.platform}</option>)}</select></label>
      {!loading && !available.length && <p className="text-sm text-white/60">Prepare a vertical platform export in Studio first. It will appear here while its file is still available.</p>}
      <div className="grid gap-5 sm:grid-cols-2"><label className="text-sm text-white/80">Public title<input required minLength={3} maxLength={140} disabled={busy} className={`${field} mt-2`} value={title} onChange={event => { setTitle(event.target.value); setConsent(false); }} /></label><label className="text-sm text-white/80">Creator credit<input required maxLength={80} disabled={busy} className={`${field} mt-2`} value={creatorName} placeholder="Your public name or @handle" onChange={event => { setCreatorName(event.target.value); setConsent(false); }} /></label></div>
      <label className="text-sm text-white/80">Category<select className={`${field} mt-2`} disabled={busy} value={category} onChange={event => setCategory(event.target.value)}><option value="gaming">Gaming</option><option value="podcast">Podcast</option><option value="irl">IRL</option><option value="other">Other</option></select></label>
      <label className="flex items-start gap-3 text-sm leading-6 text-white/80"><input className="mt-1" type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />I have permission to share this clip and its source excerpt. I allow Clipper to display them, this title, and my creator credit on its public landing page. I can withdraw them here at any time.</label>
      <button type="submit" className={`${button} justify-self-start bg-lime-300/10`} disabled={busy || !consent || !exportId || !title.trim() || !creatorName.trim()}>{busy ? "Saving…" : "Submit for review"}</button>
    </form>}
    <div className="mt-9">{loading ? <p role="status" className="text-white/60">Loading showcase…</p> : rows.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{rows.map(row => <article key={row.id} className="rounded-xl border border-white/15 bg-[#050805] p-5">
      <video className="mx-auto aspect-[9/16] max-h-80 w-full rounded bg-black object-contain" controls playsInline preload="none" poster={`/api/social/showcase/${row.id}/poster`} src={`/api/social/showcase/${row.id}/video`} aria-label={`Review ${row.title}`} />
      {row.hasSourceVideo && <details className="mt-3 text-xs text-white/70"><summary className="cursor-pointer">Review original source excerpt</summary><video className="mt-3 aspect-video w-full rounded bg-black object-contain" controls playsInline preload="none" src={`/api/social/showcase/${row.id}/source`} aria-label={`Review source for ${row.title}`} /></details>}
      <h2 className="mt-4 text-base font-semibold text-white">{row.title}</h2><p className="mt-1 text-xs text-white/60">{row.creatorName} · {row.sourceTitle}</p><p className="mt-3 text-xs font-semibold uppercase text-lime-200">{row.status}</p>
      <div className="mt-4 flex flex-wrap gap-2">{review ? <>{row.status === "pending" && row.consentAt && <button className={button} disabled={busy} onClick={() => void save("PATCH", { id: row.id, action: "approve" })}>Approve for landing page</button>}<button className={button} disabled={busy} onClick={() => void save("PATCH", { id: row.id, action: "reject" })}>{row.status === "approved" ? "Remove from showcase" : "Reject"}</button></> : row.status === "withdrawn" || row.status === "rejected" ? <button className={button} disabled={busy} onClick={() => void save("PATCH", { id: row.id, action: "resubmit" })}>Allow public display & resubmit</button> : <button className={button} disabled={busy} onClick={() => void save("PATCH", { id: row.id, action: "withdraw" })}>Withdraw permission</button>}</div>
    </article>)}</div> : <p className="py-8 text-white/60">{review ? "No clips awaiting review." : "You haven’t submitted any clips yet."}</p>}</div>
  </AccountSettingsShell>;
}
