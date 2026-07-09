"use client";

import { useEffect, useState } from "react";
import { formatSeconds } from "@/lib/time";
import type { CaptionCue } from "@/lib/captionTrack";

interface CaptionCueEditorProps {
  cue: CaptionCue | null;
  onSave: (text: string) => void;
  onClose: () => void;
}

export function CaptionCueEditor({ cue, onSave, onClose }: CaptionCueEditorProps) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft(cue?.text ?? "");
  }, [cue?.id, cue?.text]);

  if (!cue) return null;

  function save() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== cue!.text) {
      onSave(trimmed);
    }
  }

  return (
    <div className="shrink-0 flex flex-wrap items-start gap-2 px-3 py-2 border-b border-[var(--color-card-border)] bg-[#030503]">
      <div className="shrink-0 pt-1">
        <span className="text-[10px] font-semibold uppercase text-[var(--color-accent)]">
          Edit caption
        </span>
        <p className="text-[10px] text-[#9aa49a] font-mono tabular-nums mt-0.5">
          {formatSeconds(cue.startTimeSeconds)} to {formatSeconds(cue.endTimeSeconds)}
        </p>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        rows={2}
        className="flex-1 min-w-[200px] text-xs bg-[#050805] border border-[var(--color-card-border)] rounded px-2 py-1.5 text-[#f4fff1] focus:outline-none focus:border-[var(--color-accent)] resize-y"
        placeholder="Caption text..."
        autoFocus
      />

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={save}
          className="text-xs px-2.5 py-1.5 rounded font-medium bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-hover)]"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2.5 py-1.5 rounded text-[#9aa49a] hover:bg-[#101810] hover:text-white"
        >
          Done
        </button>
      </div>

      <p className="w-full text-[9px] text-[#9aa49a]">
        Drag the lime handles on the timeline to trim timing. Ctrl+Enter to save.
      </p>
    </div>
  );
}
