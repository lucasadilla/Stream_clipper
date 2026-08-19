import { describe, expect, it } from "vitest";
import {
  emptyEditorState,
  resolveEditorExportPlan,
  sequenceFitsRange,
  type EditorSegment,
} from "@/lib/editorState";

function segment(id: string, sourceStart: number, sourceEnd: number): EditorSegment {
  return {
    id,
    sourceStart,
    sourceEnd,
    label: id,
    volume: 1,
    muted: false,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
  };
}

describe("timeline export planning", () => {
  const editorState = {
    ...emptyEditorState(),
    segments: [segment("old-a", 10, 15), segment("old-b", 30, 34)],
  };

  it("exports the visible selection without a saved sequence override", () => {
    const plan = resolveEditorExportPlan(
      { start: 70, end: 82 },
      editorState,
      "selection"
    );

    expect(plan).toEqual({
      scope: "selection",
      selection: { start: 70, end: 82 },
      duration: 12,
    });
  });

  it("exports all saved cuts only when sequence scope is explicit", () => {
    const plan = resolveEditorExportPlan(
      { start: 70, end: 82 },
      editorState,
      "sequence"
    );

    expect(plan.scope).toBe("sequence");
    expect(plan.selection).toEqual({ start: 10, end: 34 });
    expect(plan.duration).toBe(9);
    expect(plan.editorState).toBe(editorState);
  });

  it("rejects sequence ranges outside the saved clip envelope", () => {
    expect(sequenceFitsRange(editorState.segments, { start: 10, end: 34 })).toBe(
      true
    );
    expect(sequenceFitsRange(editorState.segments, { start: 70, end: 82 })).toBe(
      false
    );
  });
});
