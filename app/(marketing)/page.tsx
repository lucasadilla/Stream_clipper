import { YouTubeUrlInput } from "@/components/YouTubeUrlInput";
import { SessionStorageList } from "@/components/SessionStorageList";

const FEATURES = [
  {
    title: "Premiere-style timeline",
    desc: "Scrub the full stream, zoom in and out, mark in/out points, and export precise clips.",
    icon: "▬",
  },
  {
    title: "AI clip finder",
    desc: "Describe a moment in plain English — the transcript chat finds timestamps you can jump to.",
    icon: "✦",
  },
  {
    title: "Live & VOD support",
    desc: "Record live streams in the background or analyze finished broadcasts from YouTube.",
    icon: "●",
  },
  {
    title: "Native & vertical export",
    desc: "Keep the original 16:9 stream or crop to 9:16 Shorts — rendered locally with FFmpeg.",
    icon: "⬒",
  },
  {
    title: "Transcript search",
    desc: "Ask when something happened. Clickable timestamps seek the player and set your selection.",
    icon: "⌁",
  },
  {
    title: "Local storage",
    desc: "Recordings and renders stay on your machine. Delete sessions anytime to free disk space.",
    icon: "⌂",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Paste a YouTube link",
    desc: "Drop a live stream URL or VOD — we pull metadata and open the editor.",
  },
  {
    step: "02",
    title: "Find your moment",
    desc: "Scrub the timeline, use AI search, or chat with the transcript to locate highlights.",
  },
  {
    step: "03",
    title: "Mark your clip",
    desc: "Drag a selection on the timeline or use [ and ] to set in and out points.",
  },
  {
    step: "04",
    title: "Export",
    desc: "Download native widescreen or vertical Shorts — ready to post.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--color-card-border)]">
        <div className="absolute inset-0 site-hero-glow pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 lg:py-28">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-[var(--color-accent)] mb-4 tracking-wide uppercase">
              YouTube → Clips
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
              Turn livestreams into clips{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">
                without the grind
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-[var(--color-muted)] leading-relaxed mb-10 max-w-2xl">
              Paste a YouTube stream, edit on a full timeline, ask AI when things
              happened, and export native or vertical clips — while the stream is
              still live.
            </p>
          </div>

          <div id="analyze" className="scroll-mt-20">
            <YouTubeUrlInput />
          </div>
        </div>
      </section>

      {/* Recent sessions */}
      <section id="sessions" className="scroll-mt-20 border-b border-[var(--color-card-border)] bg-[var(--color-card)]/20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <SessionStorageList />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Everything in one editor</h2>
            <p className="text-[var(--color-muted)]">
              A focused workspace built around the timeline — not a dashboard of
              widgets.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)]/60 p-6 hover:border-[var(--color-accent)]/30 hover:bg-[var(--color-card)] transition-colors"
              >
                <span className="text-2xl text-[var(--color-accent)] mb-4 block opacity-90">
                  {item.icon}
                </span>
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-[var(--color-muted)] leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="scroll-mt-20 py-16 sm:py-20 border-y border-[var(--color-card-border)] bg-[var(--color-card)]/25"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">How it works</h2>
            <p className="text-[var(--color-muted)]">
              From URL to downloadable clip in four steps.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map((item) => (
              <div key={item.step} className="relative">
                <span className="text-4xl font-bold text-[var(--color-accent)]/25 font-mono">
                  {item.step}
                </span>
                <h3 className="font-semibold mt-2 mb-2">{item.title}</h3>
                <p className="text-sm text-[var(--color-muted)] leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="rounded-2xl border border-[var(--color-accent)]/30 bg-gradient-to-br from-violet-950/50 to-[var(--color-card)] p-8 sm:p-12 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Ready to clip?</h2>
            <p className="text-[var(--color-muted)] mb-8 max-w-lg mx-auto">
              Paste any YouTube live or VOD link and start editing in seconds.
            </p>
            <a
              href="#analyze"
              className="inline-flex text-sm font-semibold px-6 py-3 rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors"
            >
              Analyze a stream
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
