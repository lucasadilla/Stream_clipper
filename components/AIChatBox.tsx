"use client";

import { useState } from "react";
import posthog from "posthog-js";
import { cn } from "@/lib/utils";

interface AIChatBoxProps {
  sessionId: string;
  onClipSuggestions?: (clips: ClipSuggestion[]) => void;
}

export interface ClipSuggestion {
  id: string;
  title: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  reason: string;
  confidence: number;
  suggestedLayout: string;
  status: string;
}

const QUICK_PROMPTS = [
  "Find the best moments so far",
  "Make me 5 Shorts",
  "Find funny moments",
  "Find moments where chat said clip it",
  "Find moments with loud reactions",
];

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function AIChatBox({ sessionId, onClipSuggestions }: AIChatBoxProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);
    posthog.capture("ai_chat_message_sent", { session_id: sessionId });

    try {
      const res = await fetch(`/api/sessions/${sessionId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI request failed");

      setMessages((m) => [...m, { role: "assistant", content: data.answer }]);
      if (data.clipSuggestions?.length) {
        posthog.capture("ai_clip_suggestions_received", {
          session_id: sessionId,
          clip_count: data.clipSuggestions.length,
        });
        onClipSuggestions?.(data.clipSuggestions);
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: err instanceof Error ? err.message : "Request failed",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] flex flex-col h-[400px]">
      <div className="p-3 border-b border-[var(--color-card-border)]">
        <h3 className="font-semibold text-sm">AI Assistant</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-[var(--color-muted)] text-center py-4">
            Ask about clip-worthy moments in this stream
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "text-xs rounded-lg px-3 py-2 max-w-[90%]",
              msg.role === "user"
                ? "ml-auto bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-background)] text-[var(--color-foreground)]"
            )}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div className="text-xs text-[var(--color-muted)] animate-pulse">
            Analyzing stream context…
          </div>
        )}
      </div>

      <div className="p-2 border-t border-[var(--color-card-border)] space-y-2">
        <div className="flex flex-wrap gap-1">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => sendMessage(prompt)}
              disabled={loading}
              className="text-[10px] px-2 py-1 rounded-full border border-[var(--color-card-border)] hover:border-[var(--color-accent)] text-[var(--color-muted)]"
            >
              {prompt}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about clips…"
            className="flex-1 text-xs rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="text-xs px-3 py-2 rounded-lg bg-[var(--color-accent)] disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
