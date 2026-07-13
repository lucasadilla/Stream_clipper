const DEFAULT_ITEMS = ["Capture", "Locate", "Cut", "Ship"];

/**
 * Thin scrolling ticker band between marketing sections.
 * CSS-only animation; pauses under prefers-reduced-motion.
 */
export function MarketingMarquee({
  items = DEFAULT_ITEMS,
  repeat = 4,
}: {
  items?: string[];
  repeat?: number;
}) {
  const sequence = Array.from({ length: repeat }, () => items).flat();

  const track = (ariaHidden: boolean) => (
    <div className="marketing-marquee-track" aria-hidden={ariaHidden}>
      {sequence.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className="flex items-center whitespace-nowrap px-6 font-mono text-xs font-semibold uppercase tracking-[0.3em] text-[var(--color-accent)] sm:text-sm"
        >
          {item}
          <span className="ml-12 h-1 w-1 bg-[var(--color-accent)]/60" aria-hidden="true" />
        </span>
      ))}
    </div>
  );

  return (
    <div
      className="marketing-marquee border-y border-[var(--color-card-border)] bg-[#020302] py-3.5"
      role="marquee"
      aria-label={items.join(", ")}
    >
      {track(false)}
      {track(true)}
    </div>
  );
}
