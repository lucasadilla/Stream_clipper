export type RenderFormat = "native" | "vertical";

export function parseRenderFormat(value: unknown): RenderFormat {
  return value === "native" ? "native" : "vertical";
}
