"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { TranscriptChat } from "@/components/TranscriptChat";
import { ChatPanel } from "@/components/ChatPanel";

type SidebarTab = "assistant" | "chat";

interface SidebarPanelProps {
  sessionId: string;
  hasLiveChat: boolean;
  autoStartChat?: boolean;
  onChatStarted?: () => void;
  onSeek?: (seconds: number) => void;
}

export function SidebarPanel({
  sessionId,
  hasLiveChat,
  autoStartChat,
  onChatStarted,
  onSeek,
}: SidebarPanelProps) {
  const [tab, setTab] = useState<SidebarTab>("assistant");

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex border-b border-[#2a2a2a] bg-[#1a1a1a]">
        <TabButton active={tab === "assistant"} onClick={() => setTab("assistant")}>
          Assistant
        </TabButton>
        <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
          Live Chat
        </TabButton>
      </div>
      <div className="flex-1 min-h-0">
        {tab === "assistant" ? (
          <TranscriptChat sessionId={sessionId} onSeek={onSeek} />
        ) : (
          <ChatPanel
            sessionId={sessionId}
            hasLiveChat={hasLiveChat}
            autoStart={autoStartChat}
            onChatStarted={onChatStarted}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 text-xs py-2.5 font-medium transition-colors",
        active
          ? "text-white border-b-2 border-[var(--color-accent)] bg-[#141414]"
          : "text-[#888] hover:text-[#ccc]"
      )}
    >
      {children}
    </button>
  );
}
