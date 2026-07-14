"use client";

import { useMemo, useRef, useState } from "react";
import { formatDuration, formatSeconds } from "@/lib/time";
import {
  createEditorSegment,
  removeRangesFromSegments,
  segmentDuration,
  sequenceDuration,
  type EditorOverlay,
  type EditorSegment,
  type EditorState,
  type TimelineMarker,
} from "@/lib/editorState";
import type { TranscriptChunkInput } from "@/lib/captionTrack";
import { cn } from "@/lib/cn";

interface TimelineSequenceToolsProps {
  sessionId: string;
  state: EditorState;
  maxTime: number;
  selection: { start: number; end: number };
  currentTime: number;
  selectedSegmentId: string | null;
  markers: TimelineMarker[];
  captionChunks: TranscriptChunkInput[];
  canUndo: boolean;
  canRedo: boolean;
  onCommit: (next: EditorState) => void;
  onSelectionChange: (selection: { start: number; end: number }) => void;
  onSelectSegment: (segmentId: string | null) => void;
  onUndo: () => void;
  onRedo: () => void;
}

type ToolPanel = "transcript" | "audio" | "overlays" | "markers" | null;

export function TimelineSequenceTools({
  sessionId,
  state,
  maxTime,
  selection,
  currentTime,
  selectedSegmentId,
  markers,
  captionChunks,
  canUndo,
  canRedo,
  onCommit,
  onSelectionChange,
  onSelectSegment,
  onUndo,
  onRedo,
}: TimelineSequenceToolsProps) {
  const [panel, setPanel] = useState<ToolPanel>(null);
  const [selectedTranscriptIds, setSelectedTranscriptIds] = useState<Set<string>>(
    new Set()
  );
  const [cleanupPreview, setCleanupPreview] = useState(false);
  const [overlayText, setOverlayText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const draggedSegmentId = useRef<string | null>(null);

  const selectedSegment =
    state.segments.find((segment) => segment.id === selectedSegmentId) ?? null;
  const totalDuration = sequenceDuration(state.segments);

  const cleanupRanges = useMemo(() => {
    const sorted = [...captionChunks].sort(
      (a, b) => a.startTimeSeconds - b.startTimeSeconds
    );
    const ranges: Array<{ start: number; end: number; label: string }> = [];
    const filler = /\b(um+|uh+|erm+|ah+|you know|i mean)\b/i;
    for (const chunk of sorted) {
      if (filler.test(chunk.text)) {
        ranges.push({
          start: chunk.startTimeSeconds,
          end: chunk.endTimeSeconds,
          label: `Filler: ${chunk.text.slice(0, 42)}`,
        });
      }
    }
    for (let index = 1; index < sorted.length; index++) {
      const previous = sorted[index - 1]!;
      const current = sorted[index]!;
      const gap = current.startTimeSeconds - previous.endTimeSeconds;
      if (gap >= 1.25 && gap <= 15) {
        ranges.push({
          start: previous.endTimeSeconds + 0.12,
          end: current.startTimeSeconds - 0.12,
          label: `Silence ${formatDuration(gap)}`,
        });
      }
    }
    return ranges.filter((range) => range.end - range.start >= 0.15).slice(0, 100);
  }, [captionChunks]);

  function commitSegments(segments: EditorSegment[]) {
    const ids = new Set(segments.map((segment) => segment.id));
    onCommit({
      ...state,
      segments,
      overlays: state.overlays.filter((overlay) => ids.has(overlay.segmentId)),
    });
  }

  function addRange(start: number, end: number, label?: string) {
    const clampedStart = Math.max(0, Math.min(start, Math.max(0, maxTime - 0.05)));
    const clampedEnd = Math.max(
      clampedStart + 0.05,
      Math.min(end, maxTime)
    );
    const segment = createEditorSegment(clampedStart, clampedEnd, label);
    commitSegments([...state.segments, segment]);
    onSelectSegment(segment.id);
    onSelectionChange({ start: segment.sourceStart, end: segment.sourceEnd });
  }

  function addSelection() {
    addRange(selection.start, selection.end, `Cut ${state.segments.length + 1}`);
  }

  function updateSelectedSegment() {
    if (!selectedSegment) return;
    commitSegments(
      state.segments.map((segment) =>
        segment.id === selectedSegment.id
          ? {
              ...segment,
              sourceStart: selection.start,
              sourceEnd: selection.end,
            }
          : segment
      )
    );
  }

  function splitSelectedSegment() {
    if (!selectedSegment) return;
    if (
      currentTime <= selectedSegment.sourceStart + 0.15 ||
      currentTime >= selectedSegment.sourceEnd - 0.15
    ) {
      return;
    }
    const index = state.segments.findIndex((segment) => segment.id === selectedSegment.id);
    const left = {
      ...selectedSegment,
      id: crypto.randomUUID(),
      sourceEnd: currentTime,
      label: `${selectedSegment.label} A`,
    };
    const right = {
      ...selectedSegment,
      id: crypto.randomUUID(),
      sourceStart: currentTime,
      label: `${selectedSegment.label} B`,
    };
    const next = [...state.segments];
    next.splice(index, 1, left, right);
    commitSegments(next);
    onSelectSegment(right.id);
    onSelectionChange({ start: right.sourceStart, end: right.sourceEnd });
  }

  function deleteSelectedSegment() {
    if (!selectedSegment) return;
    const next = state.segments.filter((segment) => segment.id !== selectedSegment.id);
    commitSegments(next);
    const replacement = next[Math.min(next.length - 1, 0)] ?? null;
    onSelectSegment(replacement?.id ?? null);
    if (replacement) {
      onSelectionChange({
        start: replacement.sourceStart,
        end: replacement.sourceEnd,
      });
    }
  }

  function moveSegment(targetId: string) {
    const sourceId = draggedSegmentId.current;
    draggedSegmentId.current = null;
    if (!sourceId || sourceId === targetId) return;
    const next = [...state.segments];
    const sourceIndex = next.findIndex((segment) => segment.id === sourceId);
    const targetIndex = next.findIndex((segment) => segment.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved!);
    commitSegments(next);
  }

  function toggleTranscript(id: string) {
    setSelectedTranscriptIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectedTranscriptRanges() {
    return captionChunks
      .filter((chunk) => selectedTranscriptIds.has(chunk.id))
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
      .map((chunk) => ({
        start: chunk.startTimeSeconds,
        end: chunk.endTimeSeconds,
        label: chunk.text.slice(0, 48),
      }));
  }

  function addSelectedTranscript() {
    const additions = selectedTranscriptRanges().map((range) =>
      createEditorSegment(range.start, range.end, range.label)
    );
    if (additions.length === 0) return;
    commitSegments([...state.segments, ...additions]);
    setSelectedTranscriptIds(new Set());
  }

  function removeRanges(ranges: Array<{ start: number; end: number }>) {
    const base =
      state.segments.length > 0
        ? state.segments
        : [createEditorSegment(selection.start, selection.end, "Primary cut")];
    commitSegments(removeRangesFromSegments(base, ranges));
    setSelectedTranscriptIds(new Set());
  }

  function updateSelectedAudio(patch: Partial<EditorSegment>) {
    if (!selectedSegment) return;
    commitSegments(
      state.segments.map((segment) =>
        segment.id === selectedSegment.id ? { ...segment, ...patch } : segment
      )
    );
  }

  function addTextOverlay(type: "text" | "lower-third") {
    if (!selectedSegment || !overlayText.trim()) return;
    const overlay: EditorOverlay = {
      id: crypto.randomUUID(),
      type,
      segmentId: selectedSegment.id,
      startOffsetSeconds: 0,
      endOffsetSeconds: segmentDuration(selectedSegment),
      label: type === "lower-third" ? "Lower third" : "Text",
      text: overlayText.trim(),
      position: type === "lower-third" ? "bottom-left" : "center",
      scalePercent: 35,
    };
    onCommit({ ...state, overlays: [...state.overlays, overlay] });
    setOverlayText("");
  }

  async function uploadOverlay(file: File) {
    if (!selectedSegment) return;
    setUploading(true);
    setAssetError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/sessions/${sessionId}/editor-assets`, {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as {
        assetPath?: string;
        mimeType?: string;
        name?: string;
        error?: string;
      };
      if (!response.ok || !data.assetPath) {
        throw new Error(data.error ?? "Asset upload failed");
      }
      const isVideo = data.mimeType?.startsWith("video/");
      const overlay: EditorOverlay = {
        id: crypto.randomUUID(),
        type: isVideo ? "broll" : "image",
        segmentId: selectedSegment.id,
        startOffsetSeconds: 0,
        endOffsetSeconds: segmentDuration(selectedSegment),
        label: data.name?.slice(0, 80) || (isVideo ? "B-roll" : "Image"),
        assetPath: data.assetPath,
        position: isVideo ? "center" : "bottom-right",
        scalePercent: isVideo ? 100 : 30,
      };
      onCommit({ ...state, overlays: [...state.overlays, overlay] });
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : "Asset upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="shrink-0 border-b border-[var(--color-card-border)] bg-[#030503]">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 px-3 py-1.5">
        <ToolButton onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          Undo
        </ToolButton>
        <ToolButton onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-[var(--color-card-border)]" />
        <ToolButton onClick={addSelection} title="Add the selected source range">
          Add cut
        </ToolButton>
        <ToolButton
          onClick={updateSelectedSegment}
          disabled={!selectedSegment}
          title="Apply the current in/out points to this cut"
        >
          Update cut
        </ToolButton>
        <ToolButton
          onClick={splitSelectedSegment}
          disabled={!selectedSegment}
          title="Split selected cut at playhead (B)"
        >
          Split
        </ToolButton>
        <ToolButton
          onClick={deleteSelectedSegment}
          disabled={!selectedSegment}
          title="Delete selected cut; remaining cuts ripple together"
        >
          Delete
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-[var(--color-card-border)]" />
        {(["transcript", "audio", "overlays", "markers"] as const).map((item) => (
          <ToolButton
            key={item}
            onClick={() => setPanel((current) => (current === item ? null : item))}
            active={panel === item}
            title={`Open ${item} tools`}
          >
            {item === "overlays"
              ? "Overlay"
              : item.charAt(0).toUpperCase() + item.slice(1)}
          </ToolButton>
        ))}

        <button
          type="button"
          role="switch"
          aria-checked={state.settings.snapping}
          onClick={() =>
            onCommit({
              ...state,
              settings: { ...state.settings, snapping: !state.settings.snapping },
            })
          }
          className={cn(
            "ml-auto h-7 border px-2 text-[10px] font-semibold uppercase transition-colors",
            state.settings.snapping
              ? "border-[var(--color-accent)] text-[var(--color-accent)]"
              : "border-[#21301f] text-[#7f8a7a]"
          )}
          title="Toggle snapping"
        >
          Snap {state.settings.snapping ? "on" : "off"}
        </button>
        <span className="min-w-[92px] text-right font-mono text-[10px] text-[#8f9b89]">
          {state.segments.length} cuts / {formatDuration(totalDuration)}
        </span>
      </div>

      {state.segments.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto border-t border-[#172016] px-3 py-1.5">
          <span className="mr-1 shrink-0 text-[9px] font-semibold uppercase text-[#71806d]">
            Sequence
          </span>
          {state.segments.map((segment, index) => (
            <button
              key={segment.id}
              type="button"
              draggable
              onDragStart={() => {
                draggedSegmentId.current = segment.id;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => moveSegment(segment.id)}
              onClick={() => {
                onSelectSegment(segment.id);
                onSelectionChange({
                  start: segment.sourceStart,
                  end: segment.sourceEnd,
                });
              }}
              className={cn(
                "flex h-7 shrink-0 items-center gap-2 border px-2 text-[10px] transition-colors",
                selectedSegmentId === segment.id
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-white"
                  : "border-[#21301f] bg-[#070a07] text-[#9aa49a] hover:border-[#52664c]"
              )}
              title="Drag to reorder"
            >
              <span className="font-mono text-[var(--color-accent)]">{index + 1}</span>
              <span className="max-w-28 truncate">{segment.label}</span>
              <span className="font-mono text-[#71806d]">
                {formatDuration(segmentDuration(segment))}
              </span>
            </button>
          ))}
        </div>
      )}

      {panel === "transcript" && (
        <div className="border-t border-[#172016] px-3 py-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase text-[var(--color-accent)]">
              Text-based edit
            </span>
            <ToolButton onClick={addSelectedTranscript} disabled={selectedTranscriptIds.size === 0}>
              Add selected
            </ToolButton>
            <ToolButton
              onClick={() => removeRanges(selectedTranscriptRanges())}
              disabled={selectedTranscriptIds.size === 0}
            >
              Delete selected
            </ToolButton>
            <ToolButton onClick={() => setCleanupPreview((value) => !value)}>
              {cleanupPreview ? "Hide cleanup" : `Preview cleanup (${cleanupRanges.length})`}
            </ToolButton>
            {cleanupPreview && cleanupRanges.length > 0 && (
              <ToolButton onClick={() => removeRanges(cleanupRanges)}>
                Apply cleanup
              </ToolButton>
            )}
          </div>
          {cleanupPreview && cleanupRanges.length > 0 && (
            <div className="mb-2 flex max-h-16 flex-wrap gap-1 overflow-y-auto">
              {cleanupRanges.map((range, index) => (
                <button
                  type="button"
                  key={`${range.start}-${index}`}
                  onClick={() => onSelectionChange(range)}
                  className="border border-[#665427] bg-[#171307] px-2 py-1 text-[9px] text-[#e6c46c]"
                >
                  {formatSeconds(range.start)} {range.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {captionChunks.map((chunk) => (
              <button
                type="button"
                key={chunk.id}
                onClick={() => toggleTranscript(chunk.id)}
                className={cn(
                  "max-w-[22rem] border px-2 py-1 text-left text-[10px] leading-4",
                  selectedTranscriptIds.has(chunk.id)
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-white"
                    : "border-[#21301f] bg-[#070a07] text-[#a8b2a3]"
                )}
              >
                <span className="mr-2 font-mono text-[var(--color-accent)]">
                  {formatSeconds(chunk.startTimeSeconds)}
                </span>
                {chunk.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {panel === "audio" && (
        <div className="flex flex-wrap items-center gap-3 border-t border-[#172016] px-3 py-2 text-[10px]">
          {selectedSegment ? (
            <>
              <label className="flex items-center gap-2 text-[#aab5a5]">
                Volume
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={selectedSegment.volume}
                  onChange={(event) =>
                    updateSelectedAudio({ volume: Number(event.target.value) })
                  }
                  className="w-28 accent-[#95ff00]"
                />
                <span className="w-9 font-mono">{Math.round(selectedSegment.volume * 100)}%</span>
              </label>
              <label className="flex items-center gap-1.5 text-[#aab5a5]">
                <input
                  type="checkbox"
                  checked={selectedSegment.muted}
                  onChange={(event) => updateSelectedAudio({ muted: event.target.checked })}
                />
                Mute
              </label>
              <NumberControl
                label="Fade in"
                value={selectedSegment.fadeInSeconds}
                onChange={(value) => updateSelectedAudio({ fadeInSeconds: value })}
              />
              <NumberControl
                label="Fade out"
                value={selectedSegment.fadeOutSeconds}
                onChange={(value) => updateSelectedAudio({ fadeOutSeconds: value })}
              />
            </>
          ) : (
            <span className="text-[#71806d]">Select a sequence cut to edit its audio.</span>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-[#aab5a5]">
            <input
              type="checkbox"
              checked={state.settings.normalizeAudio}
              onChange={(event) =>
                onCommit({
                  ...state,
                  settings: { ...state.settings, normalizeAudio: event.target.checked },
                })
              }
            />
            Normalize loudness
          </label>
          <label className="flex items-center gap-1.5 text-[#aab5a5]">
            <input
              type="checkbox"
              checked={state.settings.denoiseAudio}
              onChange={(event) =>
                onCommit({
                  ...state,
                  settings: { ...state.settings, denoiseAudio: event.target.checked },
                })
              }
            />
            Noise cleanup
          </label>
        </div>
      )}

      {panel === "overlays" && (
        <div className="border-t border-[#172016] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={overlayText}
              onChange={(event) => setOverlayText(event.target.value)}
              placeholder="Text or lower-third"
              className="h-8 min-w-52 flex-1 border border-[#21301f] bg-[#070a07] px-2 text-xs text-white focus:border-[var(--color-accent)] focus:outline-none"
            />
            <ToolButton onClick={() => addTextOverlay("text")} disabled={!selectedSegment}>
              Add text
            </ToolButton>
            <ToolButton onClick={() => addTextOverlay("lower-third")} disabled={!selectedSegment}>
              Add lower third
            </ToolButton>
            <label
              className={cn(
                "inline-flex h-7 cursor-pointer items-center border border-[#21301f] px-2 text-[10px] font-semibold text-[#a8b2a3] hover:border-[var(--color-accent)]",
                (!selectedSegment || uploading) && "pointer-events-none opacity-40"
              )}
            >
              {uploading ? "Uploading..." : "Add image / B-roll"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadOverlay(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <label className="flex items-center gap-2 text-[10px] text-[#a8b2a3]">
              Vertical background
              <select
                value={state.settings.verticalBackground}
                onChange={(event) =>
                  onCommit({
                    ...state,
                    settings: {
                      ...state.settings,
                      verticalBackground: event.target.value === "blur" ? "blur" : "crop",
                    },
                  })
                }
                className="h-7 border border-[#21301f] bg-[#070a07] px-2 text-white"
              >
                <option value="crop">Fill crop</option>
                <option value="blur">Blur background</option>
              </select>
            </label>
          </div>
          {assetError && <p className="mt-1 text-[10px] text-[#ff8a65]">{assetError}</p>}
          {state.overlays.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {state.overlays.map((overlay) => (
                <span
                  key={overlay.id}
                  className="inline-flex h-7 items-center gap-2 border border-[#30402d] bg-[#070a07] px-2 text-[10px] text-[#b9c3b4]"
                >
                  {overlay.type}: {overlay.label}
                  <button
                    type="button"
                    aria-label={`Remove ${overlay.label}`}
                    onClick={() =>
                      onCommit({
                        ...state,
                        overlays: state.overlays.filter((item) => item.id !== overlay.id),
                      })
                    }
                    className="text-[#75806f] hover:text-white"
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {panel === "markers" && (
        <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto border-t border-[#172016] px-3 py-2">
          {markers.length === 0 ? (
            <span className="text-[10px] text-[#71806d]">Press M to mark the playhead.</span>
          ) : (
            markers.map((marker) => (
              <button
                type="button"
                key={marker.id}
                onClick={() => {
                  const end = marker.endTimeSeconds ?? marker.timeSeconds + 20;
                  addRange(marker.timeSeconds, end, marker.label);
                }}
                className="border border-[#30402d] bg-[#070a07] px-2 py-1 text-left text-[10px] text-[#b9c3b4] hover:border-[var(--color-accent)]"
                title="Add this marker range to the sequence"
              >
                <span className="mr-2 font-mono text-[var(--color-accent)]">
                  {formatSeconds(marker.timeSeconds)}
                </span>
                {marker.label}
                {marker.score != null ? ` / ${marker.score.toFixed(1)}` : ""}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ToolButton({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "h-7 border px-2 text-[10px] font-semibold text-[#a8b2a3] transition-colors hover:border-[var(--color-accent)] hover:text-white disabled:opacity-35",
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-white"
          : "border-[#21301f] bg-[#070a07]"
      )}
    >
      {children}
    </button>
  );
}

function NumberControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[#aab5a5]">
      {label}
      <input
        type="number"
        min="0"
        max="10"
        step="0.1"
        value={value}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        className="h-7 w-16 border border-[#21301f] bg-[#070a07] px-2 font-mono text-white"
      />
      s
    </label>
  );
}
