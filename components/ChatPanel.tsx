"use client";

import { useState, useEffect, useRef } from "react";

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
      onChatStarted?.();
      await fetchMessages();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start chat tracking");
    } finally {
      setLoading(false);
    }
  }

  async function pollChat() {
    try {
      await fetch(`/api/sessions/${sessionId}/chat/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poll" }),
      });
      await fetchMessages();
    } catch {
      // silent poll failure
    }
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
      pollRef.current = setInterval(pollChat, 8000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [tracking, sessionId]);

  return (
    <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] flex flex-col h-64">
      <div className="p-3 border-b border-[var(--color-card-border)] flex items-center justify-between">
        <h3 className="font-semibold text-sm">Live Chat</h3>
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
