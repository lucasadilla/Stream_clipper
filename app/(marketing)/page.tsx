import { ParticleEditingHero } from "@/components/ParticleEditingHero";
import { SessionStorageList } from "@/components/SessionStorageList";
import { StreamUrlInput } from "@/components/YouTubeUrlInput";
import { BillingPlanButton } from "@/components/BillingPlanButton";
import { PRICING_PLANS, USAGE_PACKS } from "@/lib/pricing";

const HERO_SIGNALS = ["Live input", "AI transcript", "Fast export"];

const PROCESS = [
  {
    step: "01",
    title: "Capture",
    desc: "Paste a live stream or VOD and open an editing timeline while the source is still moving.",
  },
  {
    step: "02",
    title: "Locate",
    desc: "Search transcript, chat, timestamps, and audio spikes instead of dragging through dead air.",
  },
  {
    step: "03",
    title: "Cut",
    desc: "Set in and out points with the video, captions, and transcript locked to the same moment.",
  },
  {
    step: "04",
    title: "Ship",
    desc: "Render native clips or vertical Shorts with the final MP4 ready while the topic is still hot.",
  },
];

const SIGNALS = [
  {
    label: "Timeline",
    desc: "A fast editing surface with tracks, playhead control, selections, captions, and exports.",
  },
  {
    label: "Transcript",
    desc: "Search the spoken stream like a command layer, then jump straight to the timestamp.",
  },
  {
    label: "Momentum",
    desc: "Chat hype, audio movement, and clip context stay visible while you decide what to post.",
  },
];

const EXPORTS = [
  {
    title: "Native 16:9",
    desc: "Keep the stream frame intact for recaps, archives, YouTube, and long-form highlights.",
  },
  {
    title: "Shorts 9:16",
    desc: "Crop vertical, include captions, and move from live moment to publishable short.",
  },
];

export default function HomePage() {
  return (
    <div className="marketing-shell marketing-home overflow-hidden bg-[#020302]">
      <section
        className="relative isolate overflow-hidden border-b border-[var(--color-card-border)] bg-[#020302]"
        style={{ minHeight: "calc(86svh - 3.5rem)" }}
      >
        <ParticleEditingHero />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,#020302_0%,rgba(2,3,2,0.97)_28%,rgba(2,3,2,0.16)_64%,rgba(2,3,2,0.34)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-8 overflow-hidden">
          <p className="marketing-ghost-title translate-x-[-0.08em] whitespace-nowrap">
            LIVE CUT
          </p>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(0deg,#020302_8%,rgba(2,3,2,0))]" />

        <div
          className="relative mx-auto grid max-w-[1440px] px-4 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:px-8"
          style={{ minHeight: "calc(86svh - 3.5rem)" }}
        >
          <div className="z-10 flex max-w-5xl flex-col justify-center py-10 sm:py-12 lg:py-14">
            <p className="mb-4 text-xs font-semibold uppercase text-[var(--color-accent)] sm:text-sm">
              Stream Clipper / live editing system
            </p>
            <h1 className="marketing-hero-title max-w-5xl font-semibold text-white">
              Edit while it happens
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-white/74 sm:text-2xl sm:leading-9">
              Cut the moment while the stream is still moving. Search the
              transcript, lock the cut, caption the clip, and export before
              everyone else starts looking.
            </p>

            <div id="analyze" className="mt-7 max-w-2xl scroll-mt-24">
              <StreamUrlInput />
            </div>

            <div className="hero-signal-strip mt-6 grid max-w-2xl grid-cols-1 gap-px overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-card-border)] sm:grid-cols-3">
              {HERO_SIGNALS.map((signal) => (
                <div
                  key={signal}
                  className="bg-[#050805]/92 px-4 py-4 text-xs font-semibold uppercase text-white/74"
                >
                  <span className="mb-3 block h-1 w-10 bg-[var(--color-accent)]" />
                  {signal}
                </div>
              ))}
            </div>
          </div>

          <div className="hidden lg:block" aria-hidden="true" />
        </div>
      </section>

      <section
        id="features"
        className="scroll-mt-20 border-b border-[#c9d4c1] bg-[#edf5e8] text-[#071006]"
      >
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase text-[#3f6f08] sm:text-sm">
                Built for live momentum
              </p>
              <h2 className="marketing-display-title mt-4 max-w-5xl font-semibold">
                The stream does not wait.
              </h2>
            </div>
            <p className="max-w-2xl text-xl leading-8 text-[#33412c] sm:text-2xl sm:leading-9">
              Stream Clipper treats editing like a live operation: capture the
              source, find the beat, cut with context, and ship while the moment
              still has heat.
            </p>
          </div>

          <div className="mt-16 border-y border-[#bfccb7]">
            {PROCESS.map((item) => (
              <div
                key={item.step}
                className="grid gap-5 border-b border-[#bfccb7] py-7 last:border-b-0 sm:grid-cols-[5rem_0.55fr_1fr] sm:items-center lg:py-9"
              >
                <span className="font-mono text-sm text-[#4d780d]">{item.step}</span>
                <h3 className="text-4xl font-semibold leading-none sm:text-5xl lg:text-6xl">
                  {item.title}
                </h3>
                <p className="max-w-3xl text-base leading-7 text-[#3c4936] sm:text-lg">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--color-card-border)] bg-[#030503]">
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-xs font-semibold uppercase text-[var(--color-accent)] sm:text-sm">
                Command surface
              </p>
              <h2 className="mt-5 max-w-3xl text-5xl font-semibold leading-[0.92] text-white sm:text-7xl lg:text-8xl">
                Timeline, transcript, signal, export.
              </h2>
            </div>

            <div className="border-y border-[var(--color-card-border)]">
              {SIGNALS.map((signal) => (
                <div
                  key={signal.label}
                  className="grid gap-4 border-b border-[var(--color-card-border)] py-7 last:border-b-0 sm:grid-cols-[0.42fr_1fr] sm:items-start"
                >
                  <h3 className="text-3xl font-semibold text-white sm:text-4xl">
                    {signal.label}
                  </h3>
                  <p className="text-base leading-7 text-[var(--color-muted)] sm:text-lg">
                    {signal.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="scroll-mt-20 border-b border-[var(--color-card-border)] bg-[#071007]"
      >
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-end">
            <h2 className="marketing-display-title max-w-5xl font-semibold text-white">
              Export before the feed moves on.
            </h2>
            <p className="max-w-2xl text-xl leading-8 text-[var(--color-muted)] sm:text-2xl sm:leading-9">
              The workspace stays pointed at one job: turn a stream URL into a
              finished clip without losing the context that made it worth
              clipping.
            </p>
          </div>

          <div className="mt-14 grid gap-px overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-card-border)] lg:grid-cols-2">
            {EXPORTS.map((item) => (
              <div key={item.title} className="bg-[#0a0f0a] p-6 sm:p-8 lg:p-10">
                <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
                  Format
                </p>
                <h3 className="mt-5 text-4xl font-semibold leading-none text-white sm:text-6xl">
                  {item.title}
                </h3>
                <p className="mt-6 max-w-xl text-base leading-7 text-[var(--color-muted)] sm:text-lg">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="pricing"
        className="scroll-mt-20 border-b border-[var(--color-card-border)] bg-[#020302]"
      >
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase text-[var(--color-accent)] sm:text-sm">
                SaaS pricing
              </p>
              <h2 className="marketing-display-title mt-4 max-w-5xl font-semibold text-white">
                No free tier. Pay for live hours, not vague credits.
              </h2>
            </div>
            <p className="max-w-2xl text-xl leading-8 text-[var(--color-muted)] sm:text-2xl sm:leading-9">
              Processing hours cover live or VOD analysis. Exports are capped
              separately because rendering and storage are the expensive parts.
              Choose a plan to unlock the timeline. Annual plans include
              roughly two months free through yearly Stripe prices.
            </p>
          </div>

          <div className="mt-14 grid gap-px overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-card-border)] md:grid-cols-2 xl:grid-cols-4">
            {PRICING_PLANS.map((plan) => (
              <div
                key={plan.id}
                className="flex min-h-[28rem] flex-col bg-[#050805] p-5 sm:p-6"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-[var(--color-muted)]">
                      {plan.audience}
                    </p>
                    <h3 className="mt-3 text-4xl font-semibold leading-none text-white">
                      {plan.name}
                    </h3>
                  </div>
                  {plan.highlight && (
                    <span className="border border-[var(--color-accent)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--color-accent)]">
                      {plan.highlight}
                    </span>
                  )}
                </div>

                <div className="mt-8">
                  <p className="text-4xl font-semibold leading-none text-white">
                    {plan.priceLabel}
                  </p>
                  <p className="mt-2 text-xs text-[var(--color-muted)]">
                    {plan.yearlyLabel === "Custom"
                      ? "Custom annual contract"
                      : `${plan.yearlyLabel} with yearly billing`}
                  </p>
                </div>

                <div className="mt-7 border-t border-[var(--color-card-border)] pt-5">
                  <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
                    Included
                  </p>
                  <ul className="mt-4 space-y-3 text-sm leading-6 text-[#dfead8]">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 bg-[var(--color-accent)]" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <BillingPlanButton planId={plan.id} />
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-px overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-card-border)] lg:grid-cols-[0.8fr_1.2fr]">
            <div className="bg-[#071007] p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
                Overage packs
              </p>
              <h3 className="mt-4 text-4xl font-semibold leading-none text-white sm:text-5xl">
                Keep shipping when the month gets hot.
              </h3>
            </div>
            <div className="grid gap-px bg-[var(--color-card-border)] sm:grid-cols-2">
              {USAGE_PACKS.map((pack) => (
                <div key={pack.id} className="bg-[#050805] p-6 sm:p-8">
                  <p className="text-3xl font-semibold text-white">
                    ${pack.price}
                  </p>
                  <h4 className="mt-4 text-xl font-semibold text-white">
                    {pack.name}
                  </h4>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
                    {pack.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="sessions"
        className="scroll-mt-20 border-b border-[var(--color-card-border)] bg-[#020302]"
      >
        <div className="mx-auto max-w-[1440px] px-4 py-14 sm:px-6 lg:px-8">
          <SessionStorageList />
        </div>
      </section>

      <section className="bg-[#edf5e8] text-[#071006]">
        <div className="mx-auto grid max-w-[1440px] gap-9 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:px-8 lg:py-20">
          <div>
            <p className="text-xs font-semibold uppercase text-[#3f6f08] sm:text-sm">
              Ready when the clip is
            </p>
            <h2 className="mt-4 max-w-5xl text-5xl font-semibold leading-[0.92] sm:text-7xl lg:text-8xl">
              Drop a stream. Open the cut.
            </h2>
          </div>
          <a
            href="#analyze"
            className="inline-flex h-14 w-full items-center justify-center bg-[#071006] px-7 text-sm font-semibold text-white transition-colors hover:bg-[#14220f] sm:w-fit"
          >
            Start clipping now
          </a>
        </div>
      </section>
    </div>
  );
}
