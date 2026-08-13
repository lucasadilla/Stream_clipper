type RenderOutput = {
  id: string;
  clipSuggestionId: string | null;
  params?: unknown;
};

type PlatformOutput = {
  clipSuggestionId: string;
};

function isPreviewRender(params: unknown): boolean {
  return Boolean(
    params &&
      typeof params === "object" &&
      !Array.isArray(params) &&
      (params as { preview?: unknown }).preview === true
  );
}

/** One clip is one video, regardless of formats, downloads, or destinations. */
export function videoOutputUsageKeys(input: {
  renderOutputs: RenderOutput[];
  platformOutputs: PlatformOutput[];
}): Set<string> {
  const keys = new Set<string>();
  for (const output of input.renderOutputs) {
    if (isPreviewRender(output.params)) continue;
    keys.add(
      output.clipSuggestionId
        ? `clip:${output.clipSuggestionId}`
        : `render:${output.id}`
    );
  }
  for (const output of input.platformOutputs) {
    keys.add(`clip:${output.clipSuggestionId}`);
  }
  return keys;
}

