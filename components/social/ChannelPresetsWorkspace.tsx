"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountSettingsShell } from "@/components/account/AccountSettingsShell";
import { BUILT_IN_CAPTION_PRESETS } from "@/lib/captionPresets";
import { captionPreviewStyle, CAPTION_FONT_PRESETS } from "@/lib/captionAppearance";
import { CONTENT_LOOK_PRESETS } from "@/lib/contentLookPresets";
import { defaultChannelPreset, type ChannelPreset } from "@/lib/social/channelPreset";

export interface PresetChannel { account: { id: string; platform: string; displayName: string | null; username: string | null }; preset: ChannelPreset | null }
const field = "mt-1 w-full rounded border border-white/20 bg-[#0b110b] px-3 py-2 text-sm text-white";
const label = "block text-xs text-white/60";
export function ChannelPresetsWorkspace() {
  const [channels, setChannels] = useState<PresetChannel[]>([]), [accountId, setAccountId] = useState("");
  const [preset, setPreset] = useState<ChannelPreset>(defaultChannelPreset());
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  useEffect(() => { const controller = new AbortController(); void fetch("/api/social/channel-presets", { signal: controller.signal }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setChannels(data.channels); if (data.channels.length) { const channel = data.channels[0] as PresetChannel; setAccountId(channel.account.id); setPreset(channel.preset || defaultChannelPreset(channel.account.username || channel.account.displayName || "Channel style")); } }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  function patch(value: Partial<ChannelPreset>) { setPreset((current) => ({ ...current, ...value })); setDirty(true); setMessage(null); }
  const channel = channels.find((row) => row.account.id === accountId);
  async function save() {
    setSaving(true); setError(null);
    try { const response = await fetch("/api/social/channel-presets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, preset: { ...preset, defaultHashtags: preset.defaultHashtags.filter(Boolean) } }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setPreset(data.preset); setChannels((current) => current.map((row) => row.account.id === accountId ? { ...row, preset: data.preset } : row)); setDirty(false); setMessage("Channel preset saved. Future Autopilot exports use this style; existing exports stay as reviewed."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save preset"); } finally { setSaving(false); }
  }
  return <AccountSettingsShell title="Channel presets" description="Save a distinct caption style, layout, branding, and posting defaults for each connected account." message={message} error={error}>
    {loading ? <p className="mt-8 text-white/60">Loading your channels…</p> : !channels.length ? <p className="mt-8 text-white/70">Connect an account first. <Link href="/settings/connected-accounts" className="text-lime-300">Connect accounts →</Link></p> : <>
      <label className={`${label} mt-8`}>Channel<select className={field} disabled={saving || dirty} value={accountId} onChange={(event) => { const next = channels.find((row) => row.account.id === event.target.value)!; setAccountId(next.account.id); setPreset(next.preset || defaultChannelPreset(next.account.username || next.account.displayName || "Channel style")); setDirty(false); setMessage(null); }}>{channels.map((row) => <option key={row.account.id} value={row.account.id}>{row.account.platform} · {row.account.username || row.account.displayName}</option>)}</select></label>
      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_230px]">
        <div className="space-y-5 rounded border border-white/15 bg-[#050805] p-5">
          <label className={label}>Preset name<input className={field} maxLength={80} value={preset.name} onChange={(event) => patch({ name: event.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" checked={preset.captionsEnabled} onChange={(event) => patch({ captionsEnabled: event.target.checked })} />Burn captions into exports for this channel</label>
          <label className={label}>Caption style<select className={field} value="" onChange={(event) => { const selected = BUILT_IN_CAPTION_PRESETS.find((row) => row.id === event.target.value); if (selected) patch({ captionAppearance: selected.appearance }); }}><option value="">Choose a style or customize below</option>{BUILT_IN_CAPTION_PRESETS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-4">
            <label className={label}>Font<select className={field} value={preset.captionAppearance.fontFamily} onChange={(event) => patch({ captionAppearance: { ...preset.captionAppearance, fontFamily: event.target.value } })}>{CAPTION_FONT_PRESETS.map((font) => <option key={font}>{font}</option>)}</select></label>
            <label className={label}>Size at 1080p<input className={field} type="number" min={12} max={96} value={preset.captionAppearance.fontSize} onChange={(event) => patch({ captionAppearance: { ...preset.captionAppearance, fontSize: Number(event.target.value) } })} /></label>
            <label className={label}>Text color<input className={`${field} h-10`} type="color" value={preset.captionAppearance.color} onChange={(event) => patch({ captionAppearance: { ...preset.captionAppearance, color: event.target.value } })} /></label>
            <label className={label}>Highlight color<input className={`${field} h-10`} type="color" value={preset.captionAppearance.highlightColor} onChange={(event) => patch({ captionAppearance: { ...preset.captionAppearance, highlightColor: event.target.value } })} /></label>
          </div>
          <label className={label}>Preferred framing<select className={field} value={preset.look} onChange={(event) => patch({ look: event.target.value as ChannelPreset["look"] })}>{CONTENT_LOOK_PRESETS.map((look) => <option key={look.id} value={look.id}>{look.label} — {look.behavior}</option>)}</select></label>
          <label className={label}>Brand label / handle<input className={field} maxLength={60} placeholder="@yourchannel" value={preset.branding.text} onChange={(event) => patch({ branding: { ...preset.branding, text: event.target.value } })} /></label>
          <div className="grid grid-cols-2 gap-4"><label className={label}>Brand position<select className={field} value={preset.branding.position} onChange={(event) => patch({ branding: { ...preset.branding, position: event.target.value as ChannelPreset["branding"]["position"] } })}>{["top-left", "top-right", "bottom-left", "bottom-right"].map((position) => <option key={position} value={position}>{position.replace("-", " ")}</option>)}</select></label><label className={label}>Brand color<input className={`${field} h-10`} type="color" value={preset.branding.color} onChange={(event) => patch({ branding: { ...preset.branding, color: event.target.value } })} /></label></div>
          {channel?.account.platform === "youtube" && <><label className={label}>YouTube format<select className={field} value={preset.youtubeFormat} onChange={(event) => patch({ youtubeFormat: event.target.value as "shorts" | "standard" })}><option value="shorts">Shorts · 9:16</option><option value="standard">Standard · 16:9</option></select></label><label className={label}>Requested YouTube visibility<select className={field} value={preset.privacy} onChange={(event) => patch({ privacy: event.target.value as ChannelPreset["privacy"] })}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select><span className="mt-1 block">Platform test restrictions still apply.</span></label></>}
          {channel?.account.platform === "instagram" && <label className={label}>Instagram format<select className={field} value={preset.instagramFormat} onChange={(event) => patch({ instagramFormat: event.target.value as "reel" | "feed" })}><option value="reel">Reel · 9:16</option><option value="feed">Feed · 4:5</option></select></label>}
          {channel?.account.platform === "facebook" && <label className={label}>Facebook format<select className={field} value={preset.facebookFormat} onChange={(event) => patch({ facebookFormat: event.target.value as "reel" | "page_video" })}><option value="reel">Reel · 9:16</option><option value="page_video">Page video · 16:9</option></select></label>}
          {channel?.account.platform === "tiktok" && <label className={label}>TikTok delivery<select className={field} value={preset.tiktokMode} onChange={(event) => patch({ tiktokMode: event.target.value as "direct" | "inbox" })}><option value="direct">Direct post after review</option><option value="inbox">Send to TikTok inbox after review</option></select></label>}
          {channel?.account.platform === "instagram" && <label className="flex gap-2 text-sm text-white"><input type="checkbox" checked={preset.shareToFeed} onChange={(event) => patch({ shareToFeed: event.target.checked })} />Share reels to the feed</label>}
          <label className={label}>Default hashtags (space separated)<input className={field} value={preset.defaultHashtags.join(" ")} onChange={(event) => patch({ defaultHashtags: event.target.value.split(/\s+/) })} /></label>
          <label className={label}>Caption / description footer<textarea className={field} maxLength={300} rows={2} value={preset.captionSuffix} onChange={(event) => patch({ captionSuffix: event.target.value })} /></label>
          <button disabled={saving || !dirty || !preset.name.trim()} className="rounded border border-lime-400/50 bg-lime-400/10 px-4 py-2 text-sm font-semibold text-lime-300 disabled:opacity-40" onClick={() => void save()}>{saving ? "Saving…" : "Save channel preset"}</button>{dirty && <button className="ml-3 text-xs text-orange-200" disabled={saving} onClick={() => { setPreset(channel?.preset || defaultChannelPreset(channel?.account.username || "Channel style")); setDirty(false); }}>Discard unsaved changes</button>}
        </div>
        <aside><div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-white/20 bg-gradient-to-br from-[#27442c] via-[#101910] to-black">
          {preset.branding.text && <span className={`absolute z-10 max-w-[85%] break-words px-3 text-xs font-semibold ${preset.branding.position.startsWith("bottom") ? "bottom-[20%]" : "top-[5%]"} ${preset.branding.position.endsWith("right") ? "right-0 text-right" : "left-0"}`} style={{ color: preset.branding.color }}>{preset.branding.text}</span>}
          <p className="absolute inset-x-4 top-1/3 text-center text-sm text-white/40">{CONTENT_LOOK_PRESETS.find((look) => look.id === preset.look)?.label}<br />Style preview</p>
          {preset.captionsEnabled && <div style={captionPreviewStyle(preset.captionAppearance, 400).container} className="!absolute !inset-x-3 !w-auto text-center"><span style={captionPreviewStyle(preset.captionAppearance, 400).text}>This is your caption style</span></div>}
        </div><p className="mt-3 text-xs leading-5 text-white/50">Saved styles apply to new Autopilot exports. In Studio, choose a channel preset before rendering. They never alter an approved video file.</p></aside>
      </div>
    </>}
  </AccountSettingsShell>;
}

export function StudioChannelPresetPicker({ onApply, disabled }: { onApply: (preset: ChannelPreset) => void; disabled: boolean }) {
  const [channels, setChannels] = useState<PresetChannel[]>([]), [selected, setSelected] = useState("");
  useEffect(() => { const controller = new AbortController(); void fetch("/api/social/channel-presets", { signal: controller.signal }).then(async (response) => { if (!response.ok) return; const data = await response.json(); setChannels(data.channels.filter((row: PresetChannel) => row.preset)); }).catch(() => undefined); return () => controller.abort(); }, []);
  if (!channels.length) return <Link href="/settings/channel-presets" className="text-xs text-lime-300">Set up saved channel styles →</Link>;
  return <div className="space-y-2"><label className={label}>Apply saved channel style<select disabled={disabled} className={field} value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choose a channel</option>{channels.map((row) => <option key={row.account.id} value={row.account.id}>{row.account.platform} · {row.account.username || row.account.displayName} · {row.preset?.name}</option>)}</select></label><button className="text-xs text-lime-300 disabled:opacity-40" disabled={disabled || !selected} onClick={() => { const preset = channels.find((row) => row.account.id === selected)?.preset; if (preset) onApply(preset); }}>Apply style to the next render</button></div>;
}
