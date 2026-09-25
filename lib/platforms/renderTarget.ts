import { isPlatformKey, PLATFORM_PRESETS } from "@/lib/platforms/presets";
import type { PlatformKey } from "@/lib/platforms/types";

export interface PlatformRenderTarget {
  platform: PlatformKey;
  outputId: string;
}

export function parsePlatformRenderTarget(value: unknown): PlatformRenderTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (!isPlatformKey(raw.platform)) return undefined;
  const output = PLATFORM_PRESETS[raw.platform].outputs.find((item) => item.id === raw.outputId);
  return output ? { platform: raw.platform, outputId: output.id } : undefined;
}

export function platformRenderDimensions(target: PlatformRenderTarget) {
  return PLATFORM_PRESETS[target.platform].outputs.find((item) => item.id === target.outputId)!;
}
