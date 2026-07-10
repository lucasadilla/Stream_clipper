"use client";

import { useState, useEffect, useRef } from "react";
import posthog from "posthog-js";
import { LIVE_TICK_MS } from "@/lib/timelineConstants";

interface ChatMessage {
  id: string;
  authorName: string;
  messageText: string;
  publishedAt: string;
  videoTimeSeconds?: number | null;
}

interface ChatPanelProps {
  sessionId: string;
  hasLiveChat: boolean;
  autoStart?: boolean;
  onChatStarted?: () => void;
}

export function ChatPanel({
  sessionId,
  hasLiveChat,
  autoStart,
  onChatStarted,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tracking, setTracking] = useState(false);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchMessages() {
    const res = await fetch(`/api/sessions/${sessionId}/chat`);
    const data = await res.json();
    if (res.ok) setMessages(data.messages ?? []);
  }

  async function startTracking() {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/chat/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to start");
      }
      setTracking(true);
      posthog.capture("chat_tracking_started", { session_id: sessionId });
      onChatStarted?.();
      await fetchMessages();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start chat tracking");
    } finally {
      setLoading(false);
    }
  }

  async function refreshMessages() {
    await fetchMessages();
  }

  useEffect(() => {
    fetchMessages();
  }, [sessionId]);

  useEffect(() => {
    if (autoStart && hasLiveChat && !tracking && !loading) {
      void startTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, hasLiveChat, sessionId]);

  useEffect(() => {
    if (tracking) {
      // Ingestion runs via live-tick; refresh display from DB only
      pollRef.current = setInterval(refreshMessages, LIVE_TICK_MS);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [tracking, sessionId]);

  return (
    <div className="flex flex-col h-full min-h-[200px] lg:min-h-0 bg-[#141414]">
      <div className="p-3 border-b border-[#2a2a2a] flex items-center justify-between shrink-0">
        <h3 className="font-semibold text-xs text-[#aaa]">Live Chat</h3>
        {hasLiveChat && !tracking && (
          <button
            onClick={startTracking}
            disabled={loading}
            className="text-xs px-3 py-1 rounded-lg bg-[var(--color-accent)] disabled:opacity-50"
          >
            {loading ? "Starting…" : "Start Chat Tracking"}
          </button>
        )}
        {tracking && (
          <span className="text-[10px] text-[var(--color-success)] flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
            Tracking
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)] text-center py-4">
            {hasLiveChat
              ? "Click Start Chat Tracking to ingest live chat"
              : "No live chat available for this video"}
          </p>
        ) : (
          messages.slice(-100).map((msg) => (
            <div key={msg.id} className="text-xs">
              <span className="font-medium text-[var(--color-accent)]">
                {msg.authorName}
              </span>
              <span className="text-[var(--color-muted)]">: </span>
              <span>{msg.messageText}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
