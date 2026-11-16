"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, X, Search, Trash2, RefreshCw, Download, ArrowRight } from "lucide-react";
import type { listLibrary, libraryItemView } from "@/services/clipLibraryService";
import { LIBRARY_TRASH_DAYS } from "@/lib/clipLibrary";
import styles from "./ClipLibraryWorkspace.module.css";

type LibraryData = Awaited<ReturnType<typeof listLibrary>>;
type Item = ReturnType<typeof libraryItemView>;
type Asset = Item["assets"][number];
const PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "x"];
function bytes(value: string) {
  const n = Number(value);
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
function date(value: string) { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
function duration(value: number) { return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`; }
function variant(asset: Asset) {
  const name = asset.platform === "general" ? "General" : asset.platform.replaceAll("_", " ");
  const ratio = asset.width && asset.height ? asset.width > asset.height ? "16:9" : asset.width === asset.height ? "1:1" : "vertical" : "video";
  return `${name} · ${asset.width && asset.height ? `${asset.width}×${asset.height}` : ratio} · ${asset.captions ? "captions" : "no captions"}`;
}
function statusLabel(value: string) { return ({ draft: "Draft", scheduled: "Scheduled", published: "Published", publishing: "Publishing", failed: "Needs attention", unavailable: "File unavailable" } as Record<string, string>)[value] ?? value.replaceAll("_", " "); }
function safeLink(url: string | null) { return url && /^https?:\/\//i.test(url) ? url : undefined; }

async function api<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", signal, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error ?? "This request could not be completed."), { status: response.status });
  return data as T;
}
async function startDownload(asset: Asset) {
  if (!asset.downloadUrl) throw new Error("This version is not available for download.");
  const response = await fetch(asset.downloadUrl, { method: "HEAD", cache: "no-store" });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("video/") || Number(response.headers.get("content-length")) <= 0) throw new Error("The saved file is unavailable. Refresh My Clips and try another saved version.");
  const link = document.createElement("a"); link.href = asset.downloadUrl; link.download = "";
  document.body.appendChild(link); link.click(); link.remove();
}

function ClipDetails({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(item.title);
  const [caption, setCaption] = useState(item.postingCaption);
  const [assetId, setAssetId] = useState(item.assets.find(asset => asset.status === "ready")?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asset = item.assets.find(asset => asset.id === assetId);
  useEffect(() => {
    const element = dialog.current; const focused = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); if (focused?.isConnected) focused.focus(); };
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await api(`/api/library/${item.id}`, "PATCH", { title, postingCaption: caption }); onSaved(); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save clip details."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="library-detail-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className={styles.dialogHeader}><h2 id="library-detail-title">Saved clip</h2><button onClick={onClose} aria-label="Close saved clip"><X size={20} /></button></div>
    <div className={styles.detailGrid}>
      <div className={styles.detailMedia}>
        {asset?.videoUrl ? <video key={asset.id} controls playsInline preload="metadata" poster={asset.thumbnailUrl ?? undefined} src={asset.videoUrl} aria-label="Saved clip preview" /> : <p>No playable saved version is available.</p>}
        <label className={styles.field}>Saved version<select aria-label="Saved video version" value={assetId} onChange={event => setAssetId(event.target.value)}>{item.assets.map(version => <option key={version.id} value={version.id} disabled={version.status !== "ready"}>{variant(version)}{version.savedAt ? ` · ${date(version.savedAt)}` : " · unavailable"}</option>)}</select></label>
        {asset?.downloadUrl && <button className={styles.primary} onClick={() => { void startDownload(asset).catch(error => setError(error.message)); }}><Download size={15} />Download {bytes(asset.bytes)}</button>}
      </div>
      <form onSubmit={save} className={styles.detailForm}>
        <label className={styles.field}>Title<input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required disabled={busy} /></label>
        <label className={styles.field}>Posting caption<textarea value={caption} onChange={event => setCaption(event.target.value)} maxLength={10000} rows={6} disabled={busy} /></label>
        <p className={styles.muted}>Used for new posts. Existing posts and captions already burned into the video stay as they are.</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? "Saving…" : "Save details"}</button>{item.publishUrl && <Link href={item.publishUrl} className={styles.secondary}>Post / schedule <ArrowRight size={14} /></Link>}</div>
        <p className={styles.source}>{item.sourceTitle ?? "Original video"} · {duration(item.duration)} · {date(item.createdAt)}</p>
        {safeLink(item.sourceUrl) && <a href={safeLink(item.sourceUrl)} target="_blank" rel="noopener noreferrer" className={styles.textLink}>Original source ↗</a>}
        {item.sourceAvailable && item.sourceSessionId ? <Link className={styles.textLink} href={`/sessions/${item.sourceSessionId}`}>Open active studio →</Link> : <p className={styles.muted}>The source workspace has expired. Your saved videos remain available.</p>}
        {item.posts.length > 0 && <div className={styles.postList}><h3>Posting history</h3>{item.posts.map(post => <div key={post.id}><span>{post.platform.toUpperCase()} · {post.account}</span><span>{statusLabel(post.status)}{post.scheduledFor ? ` · ${new Date(post.scheduledFor).toLocaleString()}` : ""}</span>
          <Link href={`/clips/${item.id}/publish?library=1&groupId=${post.groupId}`} className={styles.textLink}>{post.status === "failed" || post.status === "outcome_unknown" ? "Review / retry →" : "Open post →"}</Link>{safeLink(post.url) && <a href={safeLink(post.url)} target="_blank" rel="noopener noreferrer" className={styles.textLink}>View on platform ↗</a>}</div>)}</div>}
      </form>
    </div>
  </dialog>;
}

export function ClipLibraryWorkspace({ initialClipId }: { initialClipId?: string }) {
  const [data, setData] = useState<LibraryData | null>(null);
  const [query, setQuery] = useState(""); const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState(""); const [account, setAccount] = useState(""); const [status, setStatus] = useState("");
  const [days, setDays] = useState("");
  const [trash, setTrash] = useState(false); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [signedOut, setSignedOut] = useState(false);
  const [detail, setDetail] = useState<Item | null>(null); const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  const load = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ q: search, platform, account, status, days, page: String(page), trash: trash ? "1" : "0" });
    try { const next = await api<LibraryData>(`/api/library?${params}`, "GET", undefined, signal); setData(next); setSignedOut(false); setError(null); }
    catch (error) { if (signal?.aborted) return; setSignedOut((error as { status?: number }).status === 401); setError(error instanceof Error ? error.message : "Could not load My Clips."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [search, platform, account, status, days, page, trash]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); void load(controller.signal);
    const refresh = () => { if (document.visibilityState === "visible") void load(controller.signal); };
    const timer = setInterval(refresh, 15000); document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  useEffect(() => { if (!initialClipId) return; const controller = new AbortController(); void api<{ item: Item }>(`/api/library/${encodeURIComponent(initialClipId)}`, "GET", undefined, controller.signal).then(result => setDetail(result.item)).catch(() => undefined); return () => controller.abort(); }, [initialClipId]);
  async function action(item: Item, action: "trash" | "restore" | "purge") {
    if (action === "trash" && !window.confirm(`Move “${item.title}” to Trash? You can restore it for ${LIBRARY_TRASH_DAYS} days. Published posts will stay on their platforms.`)) return;
    if (action === "purge" && !window.confirm(`Permanently delete the saved videos for “${item.title}” and free their storage? This cannot be undone. Published posts will stay on their platforms.`)) return;
    setBusy(item.id); setError(null); setPlaying(null);
    try { await api(`/api/library/${item.id}`, "POST", { action, ...(action === "purge" ? { confirm: item.id } : {}) }); await load(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not update the saved clip."); }
    finally { setBusy(null); }
  }
  function reset() { setQuery(""); setSearch(""); setStatus(""); setPlatform(""); setAccount(""); setDays(""); setPage(1); }
  return <section className={styles.library}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Clipper / your library</p><h1>My Clips</h1><p className={styles.intro}>Your finished videos, ready whenever you are.</p></div><Link href="/#analyze" className={styles.primary}>Create a clip <ArrowRight size={15} /></Link></header>
    <div className={styles.storage}><span>Video storage <strong>{bytes(data?.storageBytes ?? "0")}</strong></span>{data && data.trashCount > 0 && <span>{bytes(data.trashBytes)} in Trash</span>}<span>Saved separately from your source workspace.</span></div>
    <div className={styles.toolbar}><div className={styles.tabs} role="group" aria-label="Library view"><button aria-pressed={!trash} onClick={() => { setTrash(false); setPage(1); setPlaying(null); }}>Saved clips</button><button aria-pressed={trash} onClick={() => { setTrash(true); setPage(1); setPlaying(null); }}>Trash{data?.trashCount ? ` (${data.trashCount})` : ""}</button></div>
      <button className={styles.refresh} aria-label="Refresh My Clips" disabled={loading} onClick={() => { setLoading(true); void load(); }}><RefreshCw size={16} className={loading ? styles.spin : ""} /></button></div>
    {!trash && <div className={styles.filters}><label className={styles.search}><Search size={15} /><input aria-label="Search saved clips" placeholder="Search clips or sources…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label="Filter by platform" value={platform} onChange={event => { setPlatform(event.target.value); setPage(1); }}><option value="">All platforms</option>{PLATFORMS.map(value => <option key={value} value={value}>{value === "x" ? "X" : value[0].toUpperCase() + value.slice(1)}</option>)}</select>
      <select aria-label="Filter by account" value={account} onChange={event => { setAccount(event.target.value); setPage(1); }}><option value="">All accounts</option>{data?.accounts.map(row => <option key={row.id} value={row.id}>{row.username ?? row.displayName ?? row.platform}</option>)}</select>
      <select aria-label="Filter by posting status" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{["draft", "scheduled", "published", "publishing", "failed"].map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>
      <select aria-label="Filter by date" value={days} onChange={event => { setDays(event.target.value); setPage(1); }}><option value="">All dates</option>{[7, 30, 90].map(value => <option key={value} value={value}>Last {value} days</option>)}</select>
    </div>}
    {trash && <p className={styles.trashNote}>Trash keeps your saved videos for {LIBRARY_TRASH_DAYS} days. Restore a clip, or delete it permanently to free its storage now.</p>}
    {error && <div className={styles.error} role="alert">{signedOut ? <>Sign in to see your saved clips. <Link href="/login">Sign in →</Link></> : <>{error} <button onClick={() => void load()}>Try again</button></>}</div>}
    {loading && !data ? <p className={styles.empty} role="status">Loading your saved clips…</p> : !signedOut && data?.items.length === 0 ? <div className={styles.empty}><h2>{trash ? "Trash is empty." : search || status || account || platform || days ? "No clips match these filters." : "Your finished clips will live here."}</h2><p>{trash ? "Clips you move to Trash can be restored for 30 days." : "Finished renders and platform versions are saved automatically. Starting another session keeps them here."}</p>{search || status || account || platform || days ? <button className={styles.secondary} onClick={reset}>Clear filters</button> : !trash && <Link className={styles.primary} href="/#analyze">Create your first clip →</Link>}</div> : null}
    {!signedOut && <div className={styles.grid}>{data?.items.map(item => {
      const ready = item.assets.filter(asset => asset.status === "ready");
      const asset = ready.find(asset => asset.platform === "general") ?? ready[0];
      return <article key={item.id} className={styles.card}>
        {!trash && <div className={styles.preview}>{playing === item.id && asset?.videoUrl ? <video controls autoPlay playsInline preload="metadata" src={asset.videoUrl} poster={asset.thumbnailUrl ?? undefined} aria-label={`Preview ${item.title}`} /> : <button disabled={!asset} onClick={() => setPlaying(item.id)} aria-label={`Play ${item.title}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {asset?.thumbnailUrl ? <img src={asset.thumbnailUrl} alt={item.title} loading="lazy" /> : <span className={styles.previewEmpty}>{item.assets.some(asset => asset.status === "saving") ? "Saving your video…" : "Video unavailable"}</span>}{asset && <span className={styles.play}><Play size={20} fill="currentColor" /></span>}</button>}<span className={styles.duration}>{duration(item.duration)}</span></div>}
        <div className={styles.cardBody}><div className={styles.cardMeta}><span className={styles.badge} data-status={item.status}>{trash ? "In Trash" : statusLabel(item.status)}</span><span>{date(item.createdAt)}</span></div><h2>{item.title}</h2><p className={styles.source}>{item.sourceTitle ?? "Original video"}</p>
          <p className={styles.muted}>{ready.length} saved {ready.length === 1 ? "version" : "versions"} · {bytes(item.assets.reduce((sum, asset) => sum + BigInt(asset.bytes), BigInt(0)).toString())}</p>
          {!trash && item.posts.length > 0 && <div className={styles.postSummary}>{item.posts.slice(0, 3).map(post => <span key={post.id}>{post.platform.toUpperCase()} · {statusLabel(post.status)}</span>)}</div>}
          <div className={styles.actions}>{trash ? <><button className={styles.primary} disabled={busy === item.id} onClick={() => void action(item, "restore")}>Restore</button><button className={styles.danger} disabled={busy === item.id} onClick={() => void action(item, "purge")}>Delete permanently</button></> : <>
            <button className={styles.secondary} onClick={() => { setPlaying(null); setDetail(item); }}>Edit / versions</button>{asset && <button className={styles.iconButton} aria-label={`Download ${item.title}`} disabled={busy === item.id} onClick={() => { setBusy(item.id); void startDownload(asset).catch(error => setError(error.message)).finally(() => setBusy(null)); }}><Download size={16} /></button>}
            {item.publishUrl && asset && <Link href={item.publishUrl} className={styles.textLink}>Post →</Link>}<button className={styles.iconButton} aria-label={`Move ${item.title} to Trash`} disabled={busy === item.id} onClick={() => void action(item, "trash")}><Trash2 size={15} /></button>
          </>}</div>{trash && item.deletedAt && <p className={styles.muted}>Automatically removed after {date(new Date(new Date(item.deletedAt).getTime() + LIBRARY_TRASH_DAYS * 86400000).toISOString())}.</p>}
        </div>
      </article>;
    })}</div>}
    {data && (data.page > 1 || data.hasMore) && <div className={styles.pagination}><button className={styles.secondary} disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} · {data.total} clips</span><button className={styles.secondary} disabled={loading || !data.hasMore} onClick={() => setPage(page + 1)}>Next</button></div>}
    {detail && <ClipDetails key={detail.id} item={detail} onClose={() => setDetail(null)} onSaved={() => void load()} />}
  </section>;
}
