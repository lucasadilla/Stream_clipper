import type { Metadata } from "next";
import { ParticleEditingHero } from "@/components/ParticleEditingHero";
import { SessionStorageList } from "@/components/SessionStorageList";
import { StreamUrlInput } from "@/components/YouTubeUrlInput";
import { BillingPlanButton } from "@/components/BillingPlanButton";
import { MarketingScrollMotion } from "@/components/MarketingScrollMotion";
import { DitheringBackground } from "@/components/ui/dithering-background";
import { AnimatedGradient } from "@/components/ui/animated-gradient";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { MarketingMarquee } from "@/components/MarketingMarquee";
import { PRICING_PLANS } from "@/lib/pricing";

export const metadata: Metadata = {
  alternates: { canonical: "https://streamclipper.stream/" },
  openGraph: {
    title: "Clipper - Turn Livestreams into Clips and Shorts",
    description:
      "Find the best moments in livestreams and VODs, add captions, and export 16:9 clips or 9:16 Shorts.",
    url: "https://streamclipper.stream/",
    images: [
      {
        url: "https://streamclipper.stream/og.png",
        secureUrl: "https://streamclipper.stream/og.png",
        type: "image/png",
        width: 1200,
        height: 630,
        alt: "Clipper - Turn livestreams and VODs into clips and Shorts",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Clipper - AI Livestream Editor & Shorts Generator",
    description:
      "AI finds the best moments in livestreams and VODs. Cut, caption, and export Shorts fast.",
    images: ["https://streamclipper.stream/og.png"],
  },
};

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
    desc: "Search transcript, timestamps, and audio spikes instead of dragging through dead air.",
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
    desc: "Audio movement and clip context stay visible while you decide what to post.",
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

const FAQS = [
  {
    question: "What is Clipper?",
    answer:
      "Clipper is an AI-assisted video editor for turning livestreams and VODs into publishable highlights. It combines transcript search, audio signals, captions, and a synchronized timeline in one workspace.",
  },
  {
    question: "How does Clipper find the best moments in a stream?",
    answer:
      "It helps you locate promising moments using searchable transcripts, timestamps, audio movement, and clip context. You stay in control of the final in and out points before export.",
  },
  {
    question: "Can I create YouTube Shorts from a livestream or VOD?",
    answer:
      "Yes. Clipper can turn stream moments into vertical 9:16 videos with captions for YouTube Shorts and other short-form platforms. It can also preserve the original 16:9 frame for native highlights.",
  },
  {
    question: "Does Clipper support live streams as well as recorded video?",
    answer:
      "Yes. The workflow is designed for both live streams and VODs, so you can begin finding and cutting moments while a stream is active or work from a completed recording.",
  },
  {
    question: "Do I need professional video editing experience?",
    answer:
      "No. Paste a supported stream or video URL, jump to moments through the transcript and signals, set the clip boundaries, choose captions and format, then render the MP4.",
  },
  {
    question: "What video formats can I export?",
    answer:
      "You can export native 16:9 clips for YouTube highlights and recaps, or vertical 9:16 clips with captions for Shorts and other vertical feeds.",
  },
];

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://streamclipper.stream/#organization",
      name: "Clipper",
      url: "https://streamclipper.stream/",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://streamclipper.stream/#software",
      name: "Clipper",
      url: "https://streamclipper.stream/",
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web",
      description:
        "AI-assisted livestream and VOD editor for finding highlights, adding captions, and exporting 16:9 clips or 9:16 Shorts.",
      featureList: [
        "Searchable video transcripts",
        "Audio signal analysis",
        "Synchronized video editing timeline",
        "Automatic captions",
        "16:9 and 9:16 video export",
      ],
      provider: { "@id": "https://streamclipper.stream/#organization" },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQS.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    },
  ],
};

export default function HomePage() {
  return (
    <div className="marketing-shell marketing-home overflow-hidden bg-[#020302]">
      <MarketingScrollMotion />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <section
        data-scroll-hero
        className="relative isolate overflow-hidden border-b border-[var(--color-card-border)] bg-[#020302]"
        style={{ minHeight: "calc(86svh - 4rem)" }}
      >
        <ParticleEditingHero />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,#020302_0%,rgba(2,3,2,0.97)_28%,rgba(2,3,2,0.16)_64%,rgba(2,3,2,0.34)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-8 overflow-hidden">
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(0deg,#020302_8%,rgba(2,3,2,0))]" />

        <div
          className="relative mx-auto grid max-w-[1440px] px-4 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:px-8"
          style={{ minHeight: "calc(86svh - 4rem)" }}
        >
          <div className="marketing-hero-copy z-10 flex max-w-5xl flex-col justify-center py-10 sm:py-12 lg:py-14">
            <p data-scroll-reveal="hero" className="mb-4 text-xs font-semibold uppercase text-[var(--color-accent)] sm:text-sm">
              Clipper / live editing system
            </p>
            <h1 data-scroll-reveal="hero" className="marketing-hero-title max-w-5xl text-white">
              <span>Edit while</span>{" "}
              <span>it happens</span>
            </h1>
            <p data-scroll-reveal="hero" className="mt-5 max-w-2xl text-lg leading-8 text-white/74 sm:text-2xl sm:leading-9">
              Cut the moment while the stream is still moving. Search the
              transcript, lock the cut, caption the clip, and export before
              everyone else starts looking.
            </p>

            <div id="analyze" data-scroll-reveal="hero" className="mt-7 max-w-2xl scroll-mt-24">
              <StreamUrlInput />
            </div>

            <div data-scroll-reveal="hero" className="hero-signal-strip mt-6 grid max-w-2xl grid-cols-1 gap-px overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-card-border)] sm:grid-cols-3">
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

      <MarketingMarquee />

      <section
        id="features"
        className="relative isolate scroll-mt-20 overflow-hidden border-b border-[#c9d4c1] bg-[#edf5e8] text-[#071006]"
      >
        <DitheringBackground className="-z-10" />
        <div className="relative mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div data-scroll-progress className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div data-scroll-reveal="left">
              <p className="text-xs font-semibold uppercase text-[#3f6f08] sm:text-sm">
                Built for live momentum
              </p>
              <h2 className="marketing-display-title mt-4 max-w-5xl">
                The stream does not <em>wait.</em>
              </h2>
            </div>
            <p data-scroll-reveal="right" className="max-w-2xl text-xl leading-8 text-[#33412c] sm:text-2xl sm:leading-9">
              Clipper treats editing like a live operation: capture the
              source, find the beat, cut with context, and ship while the moment
              still has heat.
            </p>
          </div>

          <div className="mt-16 border-y border-[#bfccb7]">
            {PROCESS.map((item) => (
              <div
                key={item.step}
                data-scroll-reveal="process"
                className="grid gap-5 border-b border-[#bfccb7] py-7 last:border-b-0 sm:grid-cols-[5rem_0.55fr_1fr] sm:items-center lg:py-9"
              >
                <span className="font-mono text-sm text-[#4d780d]">{item.step}</span>
                <h3 className="marketing-display text-4xl leading-none sm:text-5xl lg:text-6xl">
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

      <MarketingMarquee items={["Live input", "Transcript", "Timeline", "Export"]} />

      <section className="border-b border-[var(--color-card-border)] bg-[#030503]">
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div data-scroll-progress className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
            <div data-scroll-reveal="left" className="marketing-sticky-heading">
              <p className="text-xs font-semibold uppercase text-[var(--color-accent)] sm:text-sm">
                Command surface
              </p>
              <h2 className="marketing-display mt-5 max-w-3xl text-5xl leading-[0.92] text-white sm:text-7xl lg:text-8xl">
                Timeline, transcript, signal, export.
              </h2>
            </div>

            <div className="border-y border-[var(--color-card-border)]">
              {SIGNALS.map((signal) => (
                <div
                  key={signal.label}
                  data-scroll-reveal="right"
                  className="grid gap-4 border-b border-[var(--color-card-border)] py-7 last:border-b-0 sm:grid-cols-[0.42fr_1fr] sm:items-start"
                >
                  <h3 className="marketing-display text-3xl text-white sm:text-4xl">
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

      <MarketingMarquee />

      <section
        id="how-it-works"
        className="relative isolate scroll-mt-20 overflow-hidden border-b border-[var(--color-card-border)] bg-[#071007]"
      >
        <AnimatedGradient
          className="-z-10"
          config={{
            preset: "custom",
            color1: "#071007",
            color2: "#12260c",
            color3: "#95ff00",
            rotation: -45,
            proportion: 55,
            scale: 0.6,
            speed: 15,
            distortion: 40,
            swirl: 80,
            swirlIterations: 10,
            softness: 100,
            offset: 200,
            shape: "Edge",
            shapeSize: 50,
          }}
          noise={{ opacity: 0.4 }}
        />
        <div
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(7,16,7,0.78)_0%,rgba(7,16,7,0.5)_38%,rgba(7,16,7,0.42)_100%)]"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div data-scroll-progress className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-end">
            <h2 data-scroll-reveal="left" className="marketing-display-title max-w-5xl text-white">
              Beat the <em>feed.</em>
            </h2>
            <p data-scroll-reveal="right" className="max-w-2xl text-xl leading-8 text-[var(--color-muted)] sm:text-2xl sm:leading-9">
              Turn a stream URL into a finished clip without losing the moment.
            </p>
          </div>

          <div className="mt-14 grid gap-4 lg:grid-cols-2">
            {EXPORTS.map((item) => (
              <div
                key={item.title}
                data-scroll-reveal="card"
                className="marketing-glass-card p-6 sm:p-8 lg:p-10"
              >
                <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
                  Format
                </p>
                <h3 className="marketing-display mt-5 text-4xl leading-none text-white sm:text-6xl">
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

      <MarketingMarquee items={["Native 16:9", "Shorts 9:16", "Captions", "FFmpeg export"]} />

      <section
        id="pricing"
        className="scroll-mt-20 border-b border-[var(--color-card-border)] bg-[#020302]"
      >
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div data-scroll-progress className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div data-scroll-reveal="left">
              <p className="text-xs font-semibold uppercase text-[var(--color-accent)] sm:text-sm">
                SaaS pricing
              </p>
              <h2 className="marketing-display-title mt-4 max-w-5xl text-white">
                Pay for live hours.
              </h2>
            </div>
            <p data-scroll-reveal="right" className="max-w-2xl text-xl leading-8 text-[var(--color-muted)] sm:text-2xl sm:leading-9">
              Processing hours cover live or VOD analysis. Exports are capped
              separately—rendering and storage are the expensive parts.
            </p>
          </div>

          <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {PRICING_PLANS.map((plan) => (
              <div
                key={plan.id}
                data-scroll-reveal="card"
                className="marketing-glass-card flex min-h-[28rem] flex-col p-5 sm:p-6"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-[var(--color-muted)]">
                      {plan.audience}
                    </p>
                    <h3 className="marketing-display mt-3 text-4xl leading-none text-white">
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

          <div
            data-scroll-reveal="card"
            className="marketing-glass-card mt-8 p-6 sm:p-8"
          >
            <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
              Need more capacity?
            </p>
            <h3 className="marketing-display mt-4 text-3xl text-white sm:text-4xl">
              Upgrade your plan when you hit the limit.
            </h3>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-muted)]">
              Processing hours and exports reset each billing period. Move up to
              Pro or Studio for more room — no overage packs.
            </p>
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

      <section
        id="faq"
        className="scroll-mt-20 border-b border-[var(--color-card-border)] bg-[#071007]"
      >
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr]">
            <div data-scroll-reveal="left" className="marketing-sticky-heading">
              <p className="text-xs font-semibold uppercase text-[var(--color-accent)] sm:text-sm">
                Frequently asked questions
              </p>
              <h2 className="marketing-display-title mt-4 text-white">
                Livestream clipping, <em>explained.</em>
              </h2>
              <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--color-muted)]">
                Straight answers about finding stream highlights, creating
                captioned Shorts, and exporting clips while the moment is fresh.
              </p>
            </div>
            <div className="border-y border-[var(--color-card-border)]">
              {FAQS.map((item) => (
                <details
                  key={item.question}
                  data-scroll-reveal="right"
                  className="group border-b border-[var(--color-card-border)] last:border-b-0"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-xl font-semibold text-white marker:content-none sm:text-2xl">
                    {item.question}
                    <span className="text-[var(--color-accent)] transition-transform group-open:rotate-45" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p className="max-w-3xl pb-7 pr-10 text-base leading-7 text-[var(--color-muted)] sm:text-lg">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative isolate overflow-hidden bg-[#edf5e8] text-[#071006]">
        <AuroraBackground
          className="absolute inset-0 -z-10"
          variant="custom"
          colors={[
            "hsla(85, 100%, 45%, 0.45)",
            "hsla(140, 60%, 42%, 0.22)",
            "transparent",
          ]}
          speed={0.8}
        />
        <div data-scroll-progress className="relative mx-auto grid max-w-[1440px] gap-9 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:px-8 lg:py-20">
          <div data-scroll-reveal="left">
            <p className="text-xs font-semibold uppercase text-[#3f6f08] sm:text-sm">
              Ready when the clip is
            </p>
            <h2 className="marketing-display mt-4 max-w-5xl text-5xl leading-[0.92] sm:text-7xl lg:text-8xl">
              Drop a stream. Open the cut.
            </h2>
          </div>
          <a
            href="#analyze"
            data-scroll-reveal="right"
            className="inline-flex h-14 w-full items-center justify-center bg-[#071006] px-7 text-sm font-semibold text-white transition-colors hover:bg-[#14220f] sm:w-fit"
          >
            Start clipping now
          </a>
        </div>
      </section>
    </div>
  );
}
