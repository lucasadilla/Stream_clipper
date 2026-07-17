"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import posthog from "posthog-js";
import { LIVE_TICK_MS } from "@/lib/timelineConstants";
import { formatSeconds } from "@/lib/time";
import { cn } from "@/lib/cn";
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import { ScrollButton } from "@/components/ui/scroll-button";

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
  currentTime: number;
  onSeek: (seconds: number) => void;
  autoStart?: boolean;
  onChatStarted?: () => void;
}

const FETCH_WINDOW_SECONDS = 120;
const REFETCH_EDGE_SECONDS = 40;

function messageTime(msg: ChatMessage): number | null {
  if (msg.videoTimeSeconds == null || !Number.isFinite(msg.videoTimeSeconds)) {
    return null;
  }
  return msg.videoTimeSeconds;
}

function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function ChatPanel({
  sessionId,
  hasLiveChat,
  currentTime,
  onSeek,
  autoStart,
  onChatStarted,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tracking, setTracking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadedRangeRef = useRef<{ start: number; end: number } | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const fetchInFlight = useRef(false);

  async function fetchMessages(around: number | null) {
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    try {
      const params = new URLSearchParams({ limit: "400" });
      if (around != null && Number.isFinite(around)) {
        params.set("around", String(Math.max(0, around)));
        params.set("window", String(FETCH_WINDOW_SECONDS));
      }
      const res = await fetch(`/api/sessions/${sessionId}/chat?${params}`);
      const data = await res.json();
      if (!res.ok) return;
      const next = (data.messages ?? []) as ChatMessage[];
      setMessages(next);
      if (around != null && Number.isFinite(around)) {
        loadedRangeRef.current = {
          start: Math.max(0, around - FETCH_WINDOW_SECONDS),
          end: around + FETCH_WINDOW_SECONDS,
        };
      } else if (next.length > 0) {
        const times = next
          .map(messageTime)
          .filter((t): t is number => t != null);
        if (times.length > 0) {
          loadedRangeRef.current = {
            start: Math.min(...times),
            end: Math.max(...times),
          };
        }
      }
    } finally {
      fetchInFlight.current = false;
    }
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
      await fetchMessages(currentTime);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start chat tracking");
    } finally {
      setLoading(false);
    }
  }

  async function pollAndRefresh() {
    try {
      await fetch(`/api/sessions/${sessionId}/chat/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poll" }),
      });
    } catch {
      // display refresh still useful if poll fails
    }
    await fetchMessages(currentTime);
  }

  useEffect(() => {
    loadedRangeRef.current = null;
    void fetchMessages(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (autoStart && hasLiveChat && !tracking && !loading) {
      void startTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, hasLiveChat, sessionId]);

  useEffect(() => {
    if (!tracking) return;
    pollRef.current = setInterval(() => {
      void pollAndRefresh();
    }, LIVE_TICK_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, sessionId]);

  useEffect(() => {
    if (tracking) return;
    const range = loadedRangeRef.current;
    if (!range) return;
    const nearEdge =
      currentTime < range.start + REFETCH_EDGE_SECONDS ||
      currentTime > range.end - REFETCH_EDGE_SECONDS;
    if (!nearEdge) return;
    const t = window.setTimeout(() => {
      void fetchMessages(currentTime);
    }, 180);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, tracking, sessionId]);

  const timedMessages = useMemo(
    () =>
      messages.filter((msg) => messageTime(msg) != null) as Array<
        ChatMessage & { videoTimeSeconds: number }
      >,
    [messages]
  );

  const activeId = useMemo(() => {
    let best: (typeof timedMessages)[number] | null = null;
    for (const msg of timedMessages) {
      if (msg.videoTimeSeconds <= currentTime + 0.35) best = msg;
      else break;
    }
    return best?.id ?? null;
  }, [timedMessages, currentTime]);

  useEffect(() => {
    if (!followPlayhead || !activeId || tracking) return;
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId, followPlayhead, tracking]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#050705]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-card-border)] px-3 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f9b89]">
          Chat
        </p>
        {tracking && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--color-success)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
            Live
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-[#71806d]">
          {messages.length}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-card-border)] px-2 py-1.5">
        {hasLiveChat && !tracking && (
          <button
            type="button"
            onClick={() => void startTracking()}
            disabled={loading}
            className="h-7 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] bg-[var(--color-accent)] text-black disabled:opacity-50"
          >
            {loading ? "Starting…" : "Track live chat"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setFollowPlayhead(true)}
          className={cn(
            "ml-auto h-7 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
            followPlayhead
              ? "text-[var(--color-accent)]"
              : "text-[#8f9b89] hover:text-white"
          )}
        >
          {followPlayhead ? "Synced" : "Sync to playhead"}
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <ChatContainerRoot className="h-full px-2">
          <ChatContainerContent className="space-y-2 py-3">
            {messages.length === 0 ? (
              <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">
                {hasLiveChat
                  ? "Start tracking to pull live chat, or scrub once messages exist."
                  : "No chat for this session yet. Live YouTube chats can be tracked while recording."}
              </p>
            ) : (
              messages.map((msg) => {
                const t = messageTime(msg);
                const active = msg.id === activeId;
                const seekable = t != null;
                return (
                  <div
                    key={msg.id}
                    ref={active ? activeRef : undefined}
                    className={cn(
                      "rounded-lg transition-colors",
                      active && "bg-primary/10 ring-1 ring-primary/30"
                    )}
                  >
                    <button
                      type="button"
                      disabled={!seekable}
                      onClick={() => {
                        if (t == null) return;
                        setFollowPlayhead(true);
                        onSeek(t);
                      }}
                      className={cn(
                        "w-full text-left disabled:cursor-default",
                        !seekable && "opacity-80"
                      )}
                    >
                      <Message className="items-start px-1 py-1">
                        <MessageAvatar
                          src=""
                          alt={msg.authorName}
                          fallback={authorInitials(msg.authorName)}
                          className="h-7 w-7 border border-border"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate text-xs font-semibold text-primary">
                              {msg.authorName}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                              {t != null ? formatSeconds(t) : "--:--"}
                            </span>
                          </div>
                          <MessageContent className="bg-secondary/80 px-2.5 py-1.5 text-xs text-secondary-foreground">
                            {msg.messageText}
                          </MessageContent>
                        </div>
                      </Message>
                    </button>
                  </div>
                );
              })
            )}
            <ChatContainerScrollAnchor />
          </ChatContainerContent>
          <div className="absolute right-3 bottom-3">
            <ScrollButton className="border-border bg-card shadow-sm" />
          </div>
        </ChatContainerRoot>
      </div>
    </div>
  );
}
