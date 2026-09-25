"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/apiClient";
import {
  speakerDisplayName,
  type SpeakerContext,
  type SpeakerVisibility,
} from "@/lib/speakerContext";
import type { CaptionCue } from "@/lib/captionTrack";

type SpeakerDraft = {
  displayName: string;
  color: string;
  visibility: SpeakerVisibility;
};

export function SpeakerManager({
  sessionId,
  context,
  rangeStart,
  rangeEnd,
  onChange,
  cues,
}: {
  sessionId: string;
  context: SpeakerContext | null;
  rangeStart: number;
  rangeEnd: number;
  onChange: (context: SpeakerContext) => void;
  cues: CaptionCue[];
}) {
  const speakers = useMemo(() => {
    if (!context) return [];
    const ids = new Set(
      context.intervals
        .filter(
          (interval) =>
            interval.startTimeSeconds < rangeEnd &&
            interval.endTimeSeconds > rangeStart
        )
        .flatMap((interval) => interval.speakerIds)
    );
    return context.speakers.filter((speaker) => ids.has(speaker.id));
  }, [context, rangeEnd, rangeStart]);
  const [drafts, setDrafts] = useState<Record<string, SpeakerDraft>>({});
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCueId, setSelectedCueId] = useState("");
  const [captionSpeakerId, setCaptionSpeakerId] = useState("");

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        speakers.map((speaker) => [
          speaker.id,
          {
            displayName: speaker.displayName ?? "",
            color: speaker.color,
            visibility: speaker.visibility,
          },
        ])
      )
    );
  }, [speakers]);

  if (!context || speakers.length === 0) return null;

  async function save(speakerId: string) {
    const draft = drafts[speakerId];
    if (!draft) return;
    setSavingId(speakerId);
    setError(null);
    const result = await fetchJson<{ context?: SpeakerContext; error?: string }>(
      `/api/sessions/${sessionId}/speakers`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "update", speakerId, ...draft }),
      }
    );
    setSavingId(null);
    if (!result.ok || !result.data.context) {
      setError(result.data.error ?? "Could not save this speaker");
      return;
    }
    onChange(result.data.context);
  }

  async function merge(sourceSpeakerId: string) {
    const targetSpeakerId = mergeTargets[sourceSpeakerId];
    if (!targetSpeakerId) return;
    setSavingId(sourceSpeakerId);
    setError(null);
    const result = await fetchJson<{ context?: SpeakerContext; error?: string }>(
      `/api/sessions/${sessionId}/speakers`,
      {
        method: "PATCH",
        body: JSON.stringify({
          action: "merge",
          sourceSpeakerId,
          targetSpeakerId,
        }),
      }
    );
    setSavingId(null);
    if (!result.ok || !result.data.context) {
      setError(result.data.error ?? "Could not merge these speakers");
      return;
    }
    onChange(result.data.context);
  }

  async function assignCaption() {
    const cue = cues.find((item) => item.id === selectedCueId);
    if (!cue || !captionSpeakerId) return;
    const split = captionSpeakerId === "__new__";
    setSavingId("caption");
    setError(null);
    const result = await fetchJson<{ context?: SpeakerContext; error?: string }>(
      `/api/sessions/${sessionId}/speakers`,
      {
        method: "PATCH",
        body: JSON.stringify(
          split
            ? {
                action: "split_range",
                sourceSpeakerId: cue.speakerId ?? speakers[0]?.id,
                startTimeSeconds: cue.startTimeSeconds,
                endTimeSeconds: cue.endTimeSeconds,
              }
            : {
                action: "assign_range",
                speakerId: captionSpeakerId,
                startTimeSeconds: cue.startTimeSeconds,
                endTimeSeconds: cue.endTimeSeconds,
              }
        ),
      }
    );
    setSavingId(null);
    if (!result.ok || !result.data.context) {
      setError(result.data.error ?? "Could not update this caption");
      return;
    }
    onChange(result.data.context);
    setSelectedCueId("");
    setCaptionSpeakerId("");
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Speakers</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">
            Names and colors stay consistent across clips from this recording.
            Mark remote or voice-only participants as off-screen so framing does
            not follow an unrelated face.
          </p>
        </div>
        <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/70">
          {speakers.length} detected
        </span>
      </div>

      <div className="mt-3 grid gap-2">
        {speakers.map((speaker) => {
          const draft = drafts[speaker.id] ?? {
            displayName: speaker.displayName ?? "",
            color: speaker.color,
            visibility: speaker.visibility,
          };
          const confidence = Math.round(speaker.confidence * 100);
          return (
            <div
              key={speaker.id}
              className="rounded-xl border border-white/10 bg-black/20 p-3"
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                <label className="flex min-w-0 items-center gap-2">
                  <input
                    type="color"
                    value={draft.color}
                    aria-label={`Color for ${speakerDisplayName(speaker)}`}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [speaker.id]: { ...draft, color: event.target.value },
                      }))
                    }
                    className="h-8 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <input
                    value={draft.displayName}
                    placeholder={speakerDisplayName(speaker)}
                    aria-label="Speaker name"
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [speaker.id]: {
                          ...draft,
                          displayName: event.target.value,
                        },
                      }))
                    }
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-white outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <select
                  value={draft.visibility}
                  aria-label="Speaker visibility"
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [speaker.id]: {
                        ...draft,
                        visibility: event.target.value as SpeakerVisibility,
                      },
                    }))
                  }
                  className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
                >
                  <option value="unknown">Unmapped</option>
                  <option value="visible">Visible person</option>
                  <option value="offscreen">Off-screen voice</option>
                </select>
                <button
                  type="button"
                  disabled={savingId === speaker.id}
                  onClick={() => void save(speaker.id)}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                >
                  {savingId === speaker.id ? "Saving…" : "Save"}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-white/45">
                <span>{confidence}% attribution confidence</span>
                {speakers.length > 1 ? (
                  <>
                    <span aria-hidden>•</span>
                    <select
                      value={mergeTargets[speaker.id] ?? ""}
                      aria-label={`Merge ${speakerDisplayName(speaker)} into`}
                      onChange={(event) =>
                        setMergeTargets((current) => ({
                          ...current,
                          [speaker.id]: event.target.value,
                        }))
                      }
                      className="rounded border border-white/10 bg-black/30 px-1.5 py-1 text-[10px] text-white/70"
                    >
                      <option value="">Merge into…</option>
                      {speakers
                        .filter((target) => target.id !== speaker.id)
                        .map((target) => (
                          <option key={target.id} value={target.id}>
                            {speakerDisplayName(target)}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={!mergeTargets[speaker.id] || savingId === speaker.id}
                      onClick={() => void merge(speaker.id)}
                      className="font-semibold text-white/70 hover:text-white disabled:opacity-30"
                    >
                      Merge
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {cues.length > 0 ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-[11px] font-semibold text-white/80">
            Correct a caption speaker
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]">
            <select
              value={selectedCueId}
              aria-label="Caption to correct"
              onChange={(event) => {
                const cue = cues.find((item) => item.id === event.target.value);
                setSelectedCueId(event.target.value);
                setCaptionSpeakerId(cue?.speakerId ?? "");
              }}
              className="min-w-0 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
            >
              <option value="">Choose caption…</option>
              {cues.map((cue) => (
                <option key={cue.id} value={cue.id}>
                  {cue.text.replace(/\n/g, " ").slice(0, 72)}
                </option>
              ))}
            </select>
            <select
              value={captionSpeakerId}
              aria-label="Correct speaker"
              disabled={!selectedCueId}
              onChange={(event) => setCaptionSpeakerId(event.target.value)}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white disabled:opacity-40"
            >
              <option value="">Choose speaker…</option>
              {speakers.map((speaker) => (
                <option key={speaker.id} value={speaker.id}>
                  {speakerDisplayName(speaker)}
                </option>
              ))}
              <option value="__new__">New speaker (split)</option>
            </select>
            <button
              type="button"
              disabled={
                !selectedCueId ||
                !captionSpeakerId ||
                savingId === "caption"
              }
              onClick={() => void assignCaption()}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
            >
              {savingId === "caption" ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
    </section>
  );
}
