import { YouTubeUrlInput } from "@/components/YouTubeUrlInput";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--color-card-border)] px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)] flex items-center justify-center text-sm font-bold">
            SC
          </div>
          <span className="font-semibold">Stream Clipper</span>
        </div>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center px-6 py-20">
        <div className="text-center max-w-3xl mb-10">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Turn YouTube livestreams into Shorts with AI.
          </h1>
          <p className="text-lg text-[var(--color-muted)]">
            Paste a YouTube stream, detect the best moments from chat and AI
            signals, and render vertical clips while the stream is still live.
          </p>
        </div>

        <YouTubeUrlInput />

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl w-full">
          {[
            {
              title: "Detect hype moments",
              desc: "Chat spikes, hype words, and clip requests scored in real time.",
            },
            {
              title: "AI-powered suggestions",
              desc: "Ask for funny moments, loud reactions, or custom clip ideas.",
            },
            {
              title: "Render 9:16 Shorts",
              desc: "Auto-download from YouTube and export vertical clips with FFmpeg.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5"
            >
              <h3 className="font-semibold mb-2">{item.title}</h3>
              <p className="text-sm text-[var(--color-muted)]">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
