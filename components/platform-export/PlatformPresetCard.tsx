import type { PlatformKey } from "@/lib/platforms/types";
import { cn } from "@/lib/cn";

export interface PlatformCardDefinition {
  key: PlatformKey;
  short: string;
  name: string;
  detail: string;
  outputs: Array<{ id: string; label: string }>;
}

export function PlatformPresetCard({
  platform,
  selected,
  outputId,
  onToggle,
  onOutputChange,
}: {
  platform: PlatformCardDefinition;
  selected: boolean;
  outputId: string;
  onToggle: () => void;
  onOutputChange: (outputId: string) => void;
}) {
  return (
    <article
      className={cn(
        "group relative min-h-44 border p-4 transition-colors",
        selected
          ? "border-[#95ff00] bg-[#0a1008]"
          : "border-[#20271e] bg-[#050705] hover:border-[#4a5b43]"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="absolute inset-0 z-0"
        aria-label={`${selected ? "Remove" : "Add"} ${platform.name}`}
      />
      <div className="pointer-events-none relative z-10 flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <span
            className={cn(
              "flex h-9 min-w-9 items-center justify-center border px-2 font-mono text-[10px] font-bold",
              selected
                ? "border-[#95ff00] bg-[#95ff00] text-black"
                : "border-[#34402f] text-[#96a390]"
            )}
          >
            {platform.short}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "flex h-5 w-5 items-center justify-center border text-xs",
              selected
                ? "border-[#95ff00] bg-[#95ff00] text-black"
                : "border-[#43503e] text-transparent"
            )}
          >
            x
          </span>
        </div>
        <h3 className="mt-5 text-base font-bold text-white">{platform.name}</h3>
        <p className="mt-1 text-xs leading-5 text-[#8f9a89]">{platform.detail}</p>

        {platform.outputs.length > 1 && (
          <div className="pointer-events-auto mt-auto flex gap-1 pt-4">
            {platform.outputs.map((output) => (
              <button
                key={output.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOutputChange(output.id);
                }}
                className={cn(
                  "min-w-14 border px-2 py-1 font-mono text-[10px] font-bold",
                  selected && outputId === output.id
                    ? "border-[#95ff00] text-[#95ff00]"
                    : "border-[#2a3327] text-[#74806f] hover:text-white"
                )}
              >
                {output.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
