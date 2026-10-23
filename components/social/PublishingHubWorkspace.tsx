"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountSettingsShell } from "@/components/account/AccountSettingsShell";
import { localDateTimeValue, type PublishingPost } from "@/lib/social/workspace";
import type { PerformanceResult } from "@/lib/social/performance";

const inputClass = "w-full rounded border border-white/20 bg-[#0b110b] px-3 py-2 text-sm text-white";
const buttonClass = "rounded border border-white/20 px-3 py-2 text-sm font-medium text-white hover:border-lime-400 disabled:cursor-not-allowed disabled:opacity-40";
const primaryClass = `${buttonClass} border-lime-400/60 bg-lime-400/10 text-lime-300`;
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not complete the request");
  return body;
}
const postAction = <T,>(body: unknown) => api<T>("/api/social/workspace", { method: "POST", body: JSON.stringify(body) });
const dateKey = (date: Date) => localDateTimeValue(date).slice(0, 10);
const count = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);

function CalendarPost({ post, busy, edit }: { post: PublishingPost; busy: boolean; edit: (post: PublishingPost) => void }) {
  const editable = ["queued", "scheduled"].includes(post.status);
  return <article draggable={editable && !busy} onDragStart={(event) => event.dataTransfer.setData("text/clipper-post", post.id)} className="min-w-0 space-y-1.5 rounded border border-white/15 bg-black/40 p-2 text-xs">
    <p className="font-semibold capitalize text-lime-300">{post.platform} · {post.status === "completed" ? "Posted" : post.status === "queued" ? "Queued" : "Scheduled"}</p>
    <p className="line-clamp-2 break-words text-white" title={post.title || post.clipTitle}>{post.title || post.clipTitle}</p>
    <p className="truncate text-white/55" title={post.accountName}>{post.accountName}</p>
    <p className="text-white/75">{new Date(post.scheduledFor || post.completedAt || post.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
    {editable && <button disabled={busy} className="text-lime-300 disabled:opacity-40" onClick={() => edit(post)}>Change time</button>}
    {post.postUrl && <a href={post.postUrl} target="_blank" rel="noreferrer" className="block text-lime-300">View post ↗</a>}
  </article>;
}

function ViewsTrend({ result }: { result: PerformanceResult | undefined }) {
  const samples = result?.history.filter((point) => point.views !== null) || [];
  if (samples.length < 2) return <p className="text-xs text-white/45">A trend appears after two statistics refreshes.</p>;
  const values = samples.map((point) => point.views!), min = Math.min(...values), range = Math.max(1, Math.max(...values) - min);
  const points = values.map((value, index) => `${index / (values.length - 1) * 240},${44 - (value - min) / range * 38}`).join(" ");
  return <svg viewBox="0 0 240 50" role="img" aria-label={`Views across ${samples.length} statistics refreshes, oldest to newest: ${values.join(", ")}`} className="h-12 w-full text-lime-300"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}

export function PublishingHubWorkspace() {
  const [view, setView] = useState<"inbox" | "calendar" | "performance">("inbox");
  const [month, setMonth] = useState(() => new Date());
  const [account, setAccount] = useState("");
  const [accounts, setAccounts] = useState<Array<{ id: string; platform: string; displayName: string | null; username: string | null }>>([]);
  const [posts, setPosts] = useState<PublishingPost[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({}), [consents, setConsents] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, { title: string; caption: string }>>({});
  const [performance, setPerformance] = useState<Record<string, PerformanceResult>>({});
  const [paused, setPaused] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [schedule, setSchedule] = useState("");
  const [calendarEdit, setCalendarEdit] = useState<PublishingPost | null>(null), [editTime, setEditTime] = useState("");
  const scheduleEditor = useRef<HTMLElement>(null);
  useEffect(() => { if (calendarEdit) scheduleEditor.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [calendarEdit]);
  const [sort, setSort] = useState<"recent" | "views">("recent");
  const first = new Date(month.getFullYear(), month.getMonth(), 1); first.setDate(1 - first.getDay()); first.setHours(0, 0, 0, 0);
  const end = new Date(first); end.setDate(end.getDate() + 42);
  const rangeStart = first.toISOString(), rangeEnd = end.toISOString();
  const load = useCallback(async (next?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ view, from: rangeStart, to: rangeEnd });
    if (account) params.set("account", account);
    if (next) params.set("cursor", next);
    const data = await api<{ posts: PublishingPost[]; nextCursor: string | null; paused: boolean }>(`/api/social/workspace?${params}`, { signal });
    setPosts((current) => next ? [...current.filter((post) => !data.posts.some((row) => row.id === post.id)), ...data.posts] : data.posts);
    setCursor(data.nextCursor); setPaused(data.paused);
    if (view === "performance" && data.posts.length) {
      const query = new URLSearchParams(data.posts.map((post) => ["id", post.id]));
      const metrics = await api<{ performance: PerformanceResult[] }>(`/api/social/performance?${query}`, { signal });
      setPerformance((current) => ({ ...current, ...Object.fromEntries(metrics.performance.map((row) => [row.id, row])) }));
    }
  }, [view, account, rangeStart, rangeEnd]);
  useEffect(() => { const requested = new URLSearchParams(window.location.search).get("view"); if (requested === "calendar" || requested === "performance") setView(requested);
    void api<{ platforms: Array<{ accounts: typeof accounts }> }>("/api/social/accounts").then((data) => setAccounts(data.platforms.flatMap((platform) => platform.accounts))).catch(() => undefined);
  }, []); // Account options are independent of the selected workspace view.
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null); setSelected({}); setConsents({}); setEdits({});
    void load(undefined, controller.signal).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);
  async function run(work: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null);
    try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Request failed"); }
    finally { setBusy(false); }
  }
  async function approve(scheduled: boolean) {
    await run(async () => {
      const jobs = posts.filter((post) => selected[post.id]).map((post) => ({ id: post.id, version: post.version, tiktokConsent: consents[post.id] === true }));
      const response = await postAction<{ results: Array<{ id: string; ok: boolean; error?: string }> }>({ action: "approve", jobs, ...(scheduled ? { scheduledFor: new Date(schedule).toISOString() } : {}) });
      const failures = response.results.filter((result) => !result.ok);
      setSelected({}); setConsents({}); await load();
      setMessage(`${response.results.length - failures.length} post(s) ${scheduled ? "scheduled" : "queued"}.`);
      if (failures.length) setError(failures.map((failure) => `${posts.find((post) => post.id === failure.id)?.accountName || "Post"}: ${failure.error}`).join(" "));
    });
  }
  function change(post: PublishingPost, action: "reschedule" | "hold" | "cancel", date?: string) {
    void run(async () => { await postAction({ action, id: post.id, version: post.version, ...(date ? { scheduledFor: new Date(date).toISOString() } : {}) }); await load(); setCalendarEdit(null); setMessage(action === "hold" ? "Post returned to the inbox." : action === "cancel" ? "Post cancelled." : "Posting time updated."); });
  }
  const selectedCount = Object.values(selected).filter(Boolean).length;
  const reviewable = (post: PublishingPost) => ["draft", "awaiting_consent"].includes(post.status) && Boolean(post.previewUrl) && !edits[post.id] && (post.platform !== "tiktok" || consents[post.id] === true);
  const displayed = sort === "views" && view === "performance" ? [...posts].sort((a, b) => (performance[b.id]?.metrics?.views ?? -1) - (performance[a.id]?.metrics?.views ?? -1)) : posts;
  return <AccountSettingsShell wide title="Publishing" description="Review finished clips, plan your calendar, and see how your posts perform." message={message} error={error}>
    <div className="mt-8 flex flex-wrap items-center gap-2">
      {(["inbox", "calendar", "performance"] as const).map((tab) => <button key={tab} aria-pressed={view === tab} disabled={busy} onClick={() => setView(tab)} className={view === tab ? primaryClass : buttonClass}>{tab === "inbox" ? "Review inbox" : tab === "calendar" ? "Calendar" : "Performance"}</button>)}
      <Link href="/settings/channel-presets" className={buttonClass}>Channel presets</Link><Link href="/settings/publishing/defaults" className={buttonClass}>Defaults</Link>
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <select aria-label="Filter publishing account" className={`${inputClass} !w-auto max-w-full`} disabled={busy} value={account} onChange={(event) => setAccount(event.target.value)}><option value="">All accounts</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.platform} · {row.username || row.displayName}</option>)}</select>
      <button disabled={busy} className={paused ? primaryClass : buttonClass} onClick={() => void run(async () => { await postAction({ action: paused ? "resume" : "pause" }); setPaused(!paused); setMessage(paused ? "Publishing resumed. Autopilot stays paused until enabled in its settings." : "Publishing and Autopilot paused. Uploads already in flight may still finish."); })}>{paused ? "Resume publishing" : "Pause publishing & Autopilot"}</button>
    </div>
    {paused && <p role="status" className="mt-4 rounded border border-orange-400/30 bg-orange-400/10 p-3 text-sm text-orange-200">Publishing is paused. Queued posts stay in Clipper. <Link className="underline" href="/settings/autopilot">Manage Autopilot</Link></p>}
    {loading ? <p role="status" className="py-12 text-white/60">Loading your posts…</p> : <>
      {view === "inbox" && <>
        <div className="sticky top-0 z-10 my-5 flex flex-wrap items-center gap-3 rounded border border-white/15 bg-[#050805] p-4">
          <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" disabled={busy || !posts.some(reviewable)} checked={posts.some(reviewable) && posts.filter(reviewable).every((post) => selected[post.id])} onChange={(event) => setSelected(event.target.checked ? Object.fromEntries(posts.filter(reviewable).slice(0, 30).map((post) => [post.id, true])) : {})} />Select ready posts</label>
          <span className="text-sm text-white/60">{selectedCount} selected · up to 30 at once</span>
          <button className={primaryClass} disabled={busy || paused || !selectedCount} onClick={() => void approve(false)}>Approve & post selected</button>
          <input className={`${inputClass} !w-auto`} aria-label="Schedule selected posts for" type="datetime-local" value={schedule} onChange={(event) => setSchedule(event.target.value)} />
          <button className={buttonClass} disabled={busy || paused || !selectedCount || !schedule} onClick={() => void approve(true)}>Approve & schedule</button>
        </div>
        {!posts.length && <div className="my-10 rounded border border-white/15 p-8 text-white/70"><h2 className="text-xl text-white">Your inbox is clear</h2><p className="mt-2">Finished review drafts will appear here. Open a clip in Studio and prepare a post, or enable review drafts in Autopilot.</p><Link href="/#sessions" className="mt-4 inline-block text-lime-300">Open your clips →</Link></div>}
        <div className="grid gap-5 md:grid-cols-2">{posts.map((post) => <article key={post.id} className="rounded-xl border border-white/15 bg-[#050805] p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm font-semibold capitalize text-lime-300"><input aria-label={`Select ${post.platform} post for ${post.accountName}`} type="checkbox" disabled={busy || !reviewable(post) || (selectedCount >= 30 && !selected[post.id])} checked={selected[post.id] === true} onChange={(event) => setSelected((current) => ({ ...current, [post.id]: event.target.checked }))} />{post.platform}</label><span className="text-xs text-white/50">{post.status.replaceAll("_", " ")}</span></div>
          <p className="mb-3 text-xs text-white/60">{post.accountName} · {post.platform === "youtube" || post.platform === "tiktok" ? String(post.settings.privacy || "private") : post.platform === "x" ? "Account visibility" : "Public post"}{post.settings.youtubeFormat ? ` · ${post.settings.youtubeFormat}` : ""}</p>
          {post.previewUrl ? <video controls preload="none" src={post.previewUrl} className="mx-auto mb-4 aspect-[9/16] max-h-80 w-full rounded bg-black object-contain" aria-label={`Finished ${post.platform} export for ${post.clipTitle}`} /> : <p className="mb-4 text-sm text-orange-300">The finished export is unavailable. Open this clip to prepare it.</p>}
          <label className="block text-xs text-white/60">Title<input disabled={busy || !["draft", "awaiting_consent"].includes(post.status)} className={`${inputClass} mt-1`} value={edits[post.id]?.title ?? post.title} onChange={(event) => { setSelected((current) => ({ ...current, [post.id]: false })); setEdits((current) => ({ ...current, [post.id]: { title: event.target.value, caption: current[post.id]?.caption ?? post.caption } })); }} /></label>
          <label className="mt-3 block text-xs text-white/60">Caption / description<textarea disabled={busy || !["draft", "awaiting_consent"].includes(post.status)} rows={3} className={`${inputClass} mt-1`} value={edits[post.id]?.caption ?? post.caption} onChange={(event) => { setSelected((current) => ({ ...current, [post.id]: false })); setEdits((current) => ({ ...current, [post.id]: { title: current[post.id]?.title ?? post.title, caption: event.target.value } })); }} /></label>
          {edits[post.id] && <button className={`${primaryClass} mt-3`} disabled={busy} onClick={() => void run(async () => { const edit = edits[post.id]; await api(`/api/social/publish-jobs/${post.id}`, { method: "PATCH", body: JSON.stringify({ expectedVersion: post.version, editedContent: { ...post.content, title: edit.title, caption: edit.caption, description: edit.caption, postText: edit.caption } }) }); setEdits((current) => { const next = { ...current }; delete next[post.id]; return next; }); setConsents((current) => ({ ...current, [post.id]: false })); await load(); setMessage("Edits saved. Review the updated copy before approving."); })}>Save edits</button>}
          {post.platform === "tiktok" && ["draft", "awaiting_consent"].includes(post.status) && <div className="mt-3 space-y-2 text-xs text-white/70"><Link className="block text-lime-300" href={`/clips/${post.clipId}/publish?groupId=${post.groupId}`}>Set TikTok visibility and music confirmation →</Link><label className="flex gap-2"><input type="checkbox" disabled={busy || Boolean(edits[post.id]) || post.settings.musicUsageConfirmed !== true || (!post.settings.tiktokPrivacyLevel && post.settings.tiktokMode !== "inbox")} checked={consents[post.id] === true} onChange={(event) => { setConsents((current) => ({ ...current, [post.id]: event.target.checked })); if (!event.target.checked) setSelected((current) => ({ ...current, [post.id]: false })); }} />I reviewed this video and caption and authorize this individual TikTok post.</label></div>}
          {post.error && <p className="mt-3 text-xs text-orange-300">{post.error}</p>}
          <Link className="mt-4 inline-block text-sm text-lime-300" href={`/clips/${post.clipId}/publish?groupId=${post.groupId}`}>Open full review →</Link>
        </article>)}</div>
      </>}
      {view === "calendar" && <div className="mt-6">
        <div className="mb-4 flex items-center justify-between gap-3"><button className={buttonClass} aria-label="Previous month" disabled={busy} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>←</button><h2 className="text-xl font-semibold text-white">{month.toLocaleDateString([], { month: "long", year: "numeric" })}</h2><button className={buttonClass} aria-label="Next month" disabled={busy} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>→</button></div>
        <p className="mb-4 text-sm text-white/60">Drag a scheduled post to a day, or use Change time. Times use your browser’s local timezone. Posts in flight cannot be moved.</p>
        {calendarEdit && <section ref={scheduleEditor} aria-label="Edit posting schedule" className="mb-5 rounded border border-lime-400/40 bg-[#0b130b] p-5">
          <p className="text-sm font-semibold text-white">{calendarEdit.title || calendarEdit.clipTitle}</p><p className="mt-1 text-xs text-white/60">{calendarEdit.platform} · {calendarEdit.accountName}</p>
          <label className="mt-4 block text-xs text-white/70">New posting time<input aria-label="New posting time" type="datetime-local" value={editTime} onChange={(event) => setEditTime(event.target.value)} className={`${inputClass} mt-1 max-w-sm`} /></label>
          <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy || !editTime} className={primaryClass} onClick={() => change(calendarEdit, "reschedule", editTime)}>Move post</button><button disabled={busy} className={buttonClass} onClick={() => change(calendarEdit, "hold")}>Return to review</button><button disabled={busy} className={buttonClass} onClick={() => change(calendarEdit, "cancel")}>Cancel post</button><button disabled={busy} className={buttonClass} onClick={() => setCalendarEdit(null)}>Close editor</button></div>
        </section>}
        <div className="space-y-3 md:hidden">{[...posts].sort((a,b) => new Date(a.scheduledFor || a.completedAt || a.createdAt).getTime() - new Date(b.scheduledFor || b.completedAt || b.createdAt).getTime()).map((post) => <section key={post.id}><h3 className="mb-2 text-sm text-white/60">{new Date(post.scheduledFor || post.completedAt || post.createdAt).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</h3><CalendarPost post={post} busy={busy} edit={(item) => { setCalendarEdit(item); setEditTime(localDateTimeValue(new Date(item.scheduledFor || item.createdAt))); }} /></section>)}</div>
        <div className="hidden overflow-x-auto md:block"><div className="grid min-w-[840px] grid-cols-7 gap-px overflow-hidden rounded border border-white/15 bg-white/15">{Array.from({ length: 42 }, (_, index) => {
          const day = new Date(first); day.setDate(day.getDate() + index); const key = dateKey(day);
          return <section key={key} aria-label={day.toDateString()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (busy) return; const post = posts.find((row) => row.id === event.dataTransfer.getData("text/clipper-post")); if (!post) return; const when = new Date(post.scheduledFor || Date.now()); when.setFullYear(day.getFullYear(), day.getMonth(), day.getDate()); change(post, "reschedule", localDateTimeValue(when)); }} className={`min-h-28 min-w-0 space-y-2 bg-[#050805] p-2 ${day.getMonth() === month.getMonth() ? "" : "opacity-60"}`}>
            <h3 className="text-xs font-semibold text-white/70">{day.toLocaleDateString([], { weekday: "short", day: "numeric" })}</h3>
            {posts.filter((post) => dateKey(new Date(post.scheduledFor || post.completedAt || post.createdAt)) === key).map((post) => <CalendarPost key={`${post.id}:${post.version}`} post={post} busy={busy} edit={(item) => { setCalendarEdit(item); setEditTime(localDateTimeValue(new Date(item.scheduledFor || item.createdAt))); }} />)}
          </section>;
        })}</div></div>
        {!posts.length && <p className="mt-4 text-white/60">No scheduled or published posts in this month. Approve a draft with a posting time to add it.</p>}
      </div>}
      {view === "performance" && <div className="mt-6 space-y-4">
        <div className="flex flex-wrap gap-3"><button className={primaryClass} disabled={busy || !posts.length} onClick={() => void run(async () => { const data = await api<{ performance: PerformanceResult[] }>("/api/social/performance", { method: "POST", body: JSON.stringify({ ids: posts.slice(0, 20).map((post) => post.id) }) }); setPerformance((current) => ({ ...current, ...Object.fromEntries(data.performance.map((result) => [result.id, result])) })); setMessage("Available statistics refreshed. Each post is checked at most once an hour."); })}>Refresh statistics ({Math.min(posts.length, 20)} posts)</button>
          <select aria-label="Sort performance" className={`${inputClass} !w-auto`} value={sort} onChange={(event) => setSort(event.target.value as "recent" | "views")}><option value="recent">Newest posts</option><option value="views">Most video views</option></select>
        </div>
        <p className="text-sm text-white/60">Statistics come from each platform and can arrive late. Definitions differ between platforms; compare similar posts from the same account. A dash means unavailable. Impressions are not counted as video views.</p>
        {!posts.length && <p className="rounded border border-white/15 p-8 text-white/70">Once a post is confirmed published, its performance will appear here.</p>}
        {displayed.map((post) => { const result = performance[post.id], metrics = result?.metrics;
          return <article key={post.id} className="rounded border border-white/15 bg-[#050805] p-5">
            <div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs capitalize text-lime-300">{post.platform} · {post.accountName}</p><h2 className="mt-1 font-semibold text-white">{post.title || post.clipTitle}</h2><p className="mt-1 text-xs text-white/50">{post.completedAt && new Date(post.completedAt).toLocaleString()} · {String(post.settings.channelPresetName || post.settings.youtubeFormat || post.settings.instagramFormat || post.settings.facebookFormat || "Clip")}</p></div>{post.postUrl && <a className="text-sm text-lime-300" href={post.postUrl} target="_blank" rel="noreferrer">View post ↗</a>}</div>
            <dl className="my-4 grid grid-cols-3 gap-4 sm:grid-cols-6">{[["Views", metrics?.views], ["Likes", metrics?.likes], ["Comments", metrics?.comments], ["Shares", metrics?.shares], ["Saves", metrics?.saves], ["Impressions", metrics?.impressions]].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-white/50">{label}</dt><dd className="mt-1 text-lg text-white">{count(value as number | undefined)}</dd></div>)}</dl>
            <div className="mb-3 flex flex-wrap gap-4 text-sm text-white/75"><span>Average viewed: {metrics?.averageViewPercent == null ? "—" : `${metrics.averageViewPercent.toFixed(1)}%`}</span><span>Average watch: {metrics?.averageWatchSeconds == null ? "—" : `${metrics.averageWatchSeconds.toFixed(1)}s`}</span><span>Completed: {metrics?.completionPercent == null ? "—" : `${metrics.completionPercent.toFixed(1)}%`}</span></div>
            <button disabled={busy} className="mb-3 text-xs text-lime-300 disabled:opacity-40" onClick={() => void run(async () => { const response = await api<{ performance: PerformanceResult[] }>("/api/social/performance", { method: "POST", body: JSON.stringify({ ids: [post.id] }) }); setPerformance((current) => ({ ...current, ...Object.fromEntries(response.performance.map((row) => [row.id, row])) })); setMessage("Statistics refreshed when due. Each post is checked at most once an hour."); })}>Refresh this post</button>
            <ViewsTrend result={result} />
            <p className="mt-2 text-xs text-white/50">{result?.refreshedAt ? `Updated ${new Date(result.refreshedAt).toLocaleString()}` : "Not refreshed yet"}</p>
            {(result?.error || metrics?.note) && <p className="mt-2 text-xs text-orange-200">{result?.error || metrics?.note}</p>}
            {["youtube", "tiktok"].includes(post.platform) && <a className="mt-3 inline-block text-xs text-lime-300" href={`/api/social/accounts/${post.platform}/connect?performance=1&redirectAfter=${encodeURIComponent("/settings/publishing?view=performance")}`}>Connect {post.platform} with performance access</a>}
          </article>;
        })}
      </div>}
      {cursor && <button className={`${buttonClass} mt-6`} disabled={busy} onClick={() => void run(() => load(cursor))}>Load more {view === "calendar" ? "posts in this range" : "posts"}</button>}
    </>}
    {busy && <p role="status" className="mt-4 text-sm text-lime-300">Saving changes…</p>}
  </AccountSettingsShell>;
}
