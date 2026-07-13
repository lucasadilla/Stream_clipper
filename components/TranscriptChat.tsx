"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatSeconds } from "@/lib/time";

interface TimestampRef {
  timeSeconds: number;
  label: string;
  quote?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  found?: boolean;
  timestamps?: TimestampRef[];
}

interface TranscriptChatProps {
  sessionId: string;
  onSeek?: (seconds: number) => void;
  transcribedSeconds?: number;
  recordedSeconds?: number;
  transcribingActive?: boolean;
  transcriptionError?: string | null;
}

export function TranscriptChat({
  sessionId,
  onSeek,
  transcribedSeconds = 0,
  recordedSeconds = 0,
  transcribingActive = false,
  transcriptionError = null,
}: TranscriptChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const transcribing =
    recordedSeconds > 5 &&
    transcribedSeconds < recordedSeconds - 5;
  const progressPct =
    recordedSeconds > 0
      ? Math.min(100, Math.round((transcribedSeconds / recordedSeconds) * 100))
      : 0;

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userText = text.trim();
    setMessages((m) => [...m, { role: "user", content: userText }]);
    setInput("");
    setLoading(true);

    const history = messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await fetch(`/api/sessions/${sessionId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI request failed");

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.answer,
          found: data.found,
          timestamps: data.found ? data.timestamps : undefined,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: err instanceof Error ? err.message : "Request failed",
          found: false,
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-[var(--color-card-border)] bg-[#050705]">
      {(transcribing || transcribingActive || transcribedSeconds > 0 || transcriptionError) && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-card-border)] bg-[#020302] px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
              Transcript
            </p>
            {transcriptionError ? (
              <p className="text-xs text-[#ffb84d]">{transcriptionError}</p>
            ) : transcribing || transcribingActive ? (
              <p className="text-xs text-[#b8c7b3]">
                Transcribing... {formatSeconds(transcribedSeconds)} /{" "}
                {formatSeconds(recordedSeconds)}
                <span className="ml-2 text-[var(--color-muted)]">
                  ({progressPct}%)
                </span>
              </p>
            ) : (
              <p className="text-xs text-[var(--color-accent)]">
                Ready / {formatSeconds(transcribedSeconds)} transcribed
              </p>
            )}
          </div>
          {(transcribing || transcribingActive) && !transcriptionError && (
            <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[#152015]">
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 && (
          <p className="py-2 text-sm leading-relaxed text-[var(--color-muted)]">
            {transcribing
              ? "Transcription is in progress. You can ask questions about the transcribed portion now."
              : transcribedSeconds > 0
                ? 'Ask about the stream, like "when do they mention the score?"'
                : "Waiting for audio to transcribe. This usually starts within a minute."}
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-xl px-4 py-2.5 text-sm",
                msg.role === "user"
                  ? "rounded-br-sm bg-[var(--color-accent)] text-black shadow-[0_0_22px_rgba(149,255,0,0.18)]"
                  : msg.found === false
                    ? "rounded-bl-sm border border-[var(--color-card-border)] bg-[#070a07] text-[var(--color-muted)]"
                    : "rounded-bl-sm border border-[var(--color-card-border)] bg-[#070a07] text-[#dfead8]"
              )}
            >
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              {msg.timestamps && msg.timestamps.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {msg.timestamps.map((ts, j) => (
                    <button
                      key={j}
                      type="button"
                      onClick={() => onSeek?.(ts.timeSeconds)}
                      className="rounded-lg border border-[#21301f] bg-[#020302] px-3 py-1.5 text-left transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
                      title={ts.quote}
                    >
                      <span className="font-mono text-sm text-[var(--color-accent)]">
                        {formatSeconds(ts.timeSeconds)}
                      </span>
                      <span className="ml-2 text-xs text-[#a7b1a2]">
                        {ts.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="animate-pulse rounded-xl border border-[var(--color-card-border)] bg-[#070a07] px-4 py-2 text-sm text-[var(--color-muted)]">
              Searching transcript...
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="flex shrink-0 gap-2 border-t border-[var(--color-card-border)] bg-[#020302] px-4 py-3"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the stream..."
          className="min-w-0 flex-1 rounded-lg border border-[#21301f] bg-[#070a07] px-4 py-2.5 text-sm text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
