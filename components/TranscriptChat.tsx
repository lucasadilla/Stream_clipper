"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
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
    <div className="flex flex-col h-full min-h-0 border-t border-[#2a2a2a] bg-[#141414]">
      {(transcribing || transcribingActive || transcribedSeconds > 0 || transcriptionError) && (
        <div className="shrink-0 px-4 py-2 border-b border-[#2a2a2a] bg-[#1a1a1a] flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-[#666] mb-1">
              Transcript
            </p>
            {transcriptionError ? (
              <p className="text-xs text-[var(--color-warning)]">{transcriptionError}</p>
            ) : transcribing || transcribingActive ? (
              <p className="text-xs text-[#aaa]">
                Transcribing… {formatSeconds(transcribedSeconds)} /{" "}
                {formatSeconds(recordedSeconds)}
                <span className="text-[#666] ml-2">({progressPct}%)</span>
              </p>
            ) : (
              <p className="text-xs text-[var(--color-success)]">
                Ready · {formatSeconds(transcribedSeconds)} transcribed
              </p>
            )}
          </div>
          {(transcribing || transcribingActive) && !transcriptionError && (
            <div className="w-24 h-1.5 rounded-full bg-[#333] overflow-hidden shrink-0">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-sm text-[#666] py-2">
            {transcribing
              ? "Transcription in progress — you can ask questions about the transcribed portion now."
              : transcribedSeconds > 0
                ? "Ask about the stream — e.g. “when do they mention the score?”"
                : "Waiting for audio to transcribe… This usually starts within a minute."}
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
                "text-sm rounded-2xl px-4 py-2.5 max-w-[85%]",
                msg.role === "user"
                  ? "bg-[var(--color-accent)] text-white rounded-br-md"
                  : msg.found === false
                    ? "bg-[#1a1a1a] text-[#999] border border-[#2a2a2a] rounded-bl-md"
                    : "bg-[#1a1a1a] text-[#ddd] border border-[#2a2a2a] rounded-bl-md"
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
                      className="text-left rounded-lg border border-[#333] bg-[#0d0d0d] px-3 py-1.5 hover:border-[#e8b84a] transition-colors"
                      title={ts.quote}
                    >
                      <span className="font-mono text-sm text-[#e8b84a]">
                        {formatSeconds(ts.timeSeconds)}
                      </span>
                      <span className="text-[#aaa] text-xs ml-2">{ts.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="text-sm text-[#666] px-4 py-2 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] animate-pulse">
              Searching transcript…
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="shrink-0 flex gap-2 px-4 py-3 border-t border-[#2a2a2a] bg-[#1a1a1a]"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the stream…"
          className="flex-1 text-sm rounded-full border border-[#333] bg-[#141414] px-4 py-2.5 focus:outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="text-sm px-5 py-2.5 rounded-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white disabled:opacity-50 font-medium"
        >
          Send
        </button>
      </form>
    </div>
  );
}
