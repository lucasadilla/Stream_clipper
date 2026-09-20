"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { EditorHeader } from "@/components/layout/EditorHeader";
import type { ClipSuggestionData } from "@/components/ClipSuggestionCard";
import { AgentClipPickGrid } from "@/components/agent/AgentClipPickGrid";
import { AgentClipEditor } from "@/components/agent/AgentClipEditor";
import { AgentClipStudioModal } from "@/components/agent/AgentClipStudioModal";
import { fetchJson } from "@/lib/apiClient";
import { formatSeconds } from "@/lib/time";
import { clipThumbnailApiUrl } from "@/lib/downloadUrls";
import {
  readCaptionAppearancePreference,
  writeCaptionAppearancePreference,
  type CaptionAppearance,
} from "@/lib/captionAppearance";
import {
  TRANSCRIPTION_FAST_TICK_MS,
  TRANSCRIPTION_SLOW_TICK_MS,
} from "@/lib/transcriptionConstants";
import { cn } from "@/lib/cn";
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { Button } from "@/components/ui/button";
import { ArrowUp, MessageSquareText, Sparkles, X } from "lucide-react";
import {
  DEFAULT_AGENT_WIZARD_STATE,
  LIVE_NOW_ROLL_SECONDS,
  LIVE_NOW_SUGGESTION_CAP,
  readAgentWizardState,
  resolveAgentDisplayStep,
  type AgentWizardState,
} from "@/lib/agentWizard";
import {
  getContentLookPreset,
  type ContentLookPresetId,
} from "@/lib/contentLookPresets";
import {
  defaultVerticalLayoutSelection,
  type VerticalLayoutSelection,
} from "@/components/VerticalLayoutPicker";
import { triggerFileDownload } from "@/lib/clientDownload";
import { LIVE_TICK_MS } from "@/lib/timelineConstants";
import { mergeClipSuggestions } from "@/lib/clipSuggestionMerge";
import type { SessionMode } from "@/lib/sessionMode";
import { OperationProgress } from "@/components/ui/operation-progress";
import { renderClip } from "@/lib/clipActions";

interface AgentSessionData {
  id: string;
  title?: string | null;
  liveStatus?: string | null;
  storageLabel?: string;
  metadataJson?: unknown;
  videoDurationSeconds?: number;
  liveRecording?: { status: string; recordedSeconds: number } | null;
  sourceMedia?: Array<{
    durationSeconds?: number | null;
    previewVideoUrl?: string | null;
    sourceVideoUrl?: string | null;
    sourceIsPlayableMp4?: boolean;
  }>;
  clipSuggestions?: ClipSuggestionData[];
}

type ChatTurn =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      clip?: ClipSuggestionData | null;
      error?: boolean;
    };

const MIN_TRANSCRIPT_SECONDS = 20;
const MIN_SEARCHABLE_CHUNKS = 1;
const VOD_SUGGEST_ROLL_SECONDS = 180;

interface AgentWorkspaceProps {
  sessionId: string;
  modeSwitching?: boolean;
  onModeChange?: (mode: SessionMode) => void;
}

function withThumbnails(
  _sessionId: string,
  clips: ClipSuggestionData[]
): Array<ClipSuggestionData & { thumbnailUrl: string }> {
  return clips.map((clip) => ({
    ...clip,
    thumbnailUrl: clipThumbnailApiUrl(clip.id),
  }));
}

export function AgentWorkspace({
  sessionId,
  modeSwitching,
  onModeChange,
}: AgentWorkspaceProps) {
  const router = useRouter();
  const [session, setSession] = useState<AgentSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null
  );
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [transcribedSeconds, setTranscribedSeconds] = useState(0);
  const [recordedSecondsHint, setRecordedSecondsHint] = useState(0);
  const [searchableChunks, setSearchableChunks] = useState(0);
  const [clips, setClips] = useState<ClipSuggestionData[]>([]);
  const [wizard, setWizard] = useState<AgentWizardState>({
    ...DEFAULT_AGENT_WIZARD_STATE,
  });
  const [suggesting, setSuggesting] = useState(false);
  const [getMoreLoading, setGetMoreLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStage, setExportStage] = useState("queued");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDoneUrl, setExportDoneUrl] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [showFindChat, setShowFindChat] = useState(false);
  const [newClipNotice, setNewClipNotice] = useState(false);
  const [unseenLiveClips, setUnseenLiveClips] = useState(0);
  const [studioClipId, setStudioClipId] = useState<string | null>(null);
  const [captionAppearance, setCaptionAppearance] = useState<CaptionAppearance>(
    readCaptionAppearancePreference
  );
  const sourceStarted = useRef(false);
  const transcribeInFlight = useRef(false);
  const suggestStarted = useRef(false);
  const rollingInFlight = useRef(false);
  const liveTickInFlight = useRef(false);
  const wizardHydrated = useRef(false);
  const wizardMutationSequence = useRef(0);
  const wizardMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const visibleClips = useMemo(
    () => clips.filter((clip) => clip.status !== "rejected"),
    [clips]
  );

  const persistWizard = useCallback(
    (patch: Partial<AgentWizardState>) => {
      const mutationSequence = ++wizardMutationSequence.current;
      setWizard((current) => ({ ...current, ...patch }));
      const request = wizardMutationQueue.current.then(async () => {
        const { ok, data } = await fetchJson<{
          wizard?: AgentWizardState;
          error?: string;
        }>(`/api/sessions/${sessionId}/agent-wizard`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (
          ok &&
          data.wizard &&
          mutationSequence === wizardMutationSequence.current
        ) {
          setWizard(data.wizard);
          return data.wizard;
        }
        return null;
      });
      wizardMutationQueue.current = request.then(
        () => undefined,
        () => undefined
      );
      return request;
    },
    [sessionId]
  );

  const loadSession = useCallback(async () => {
    const { ok, data } = await fetchJson<{
      session?: AgentSessionData;
      error?: string;
    }>(`/api/sessions/${sessionId}`);
    if (!ok || !data.session) {
      throw new Error(data.error ?? "Session not found");
    }
    setSession(data.session);
    setRecordedSecondsHint((current) =>
      Math.max(
        current,
        data.session?.videoDurationSeconds ?? 0,
        data.session?.liveRecording?.recordedSeconds ?? 0,
        ...(data.session?.sourceMedia ?? []).map(
          (media) => media.durationSeconds ?? 0
        )
      )
    );
    setClips((current) =>
      mergeClipSuggestions(current, data.session?.clipSuggestions ?? [])
    );
    if (!wizardHydrated.current) {
      wizardHydrated.current = true;
      setWizard(readAgentWizardState(data.session.metadataJson));
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSession()
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));
  }, [loadSession]);

  useEffect(() => {
    if (sourceStarted.current) return;
    sourceStarted.current = true;
    void fetchJson<{
      error?: string;
      recordedSeconds?: number;
      sourceMedia?: { durationSeconds?: number | null } | null;
    }>(
      `/api/sessions/${sessionId}/download-source`,
      { method: "POST" }
    )
      .then(({ ok, data }) => {
        if (!ok) {
          setSourceError(
            data.error
              ? `Source download failed: ${data.error}`
              : "Source download failed on the server"
          );
          return;
        }
        setSourceError(null);
        setRecordedSecondsHint((current) =>
          Math.max(
            current,
            data.recordedSeconds ?? 0,
            data.sourceMedia?.durationSeconds ?? 0
          )
        );
        void loadSession().catch(() => {});
      })
      .catch((err) => {
        setSourceError(
          err instanceof Error
            ? `Source download failed: ${err.message}`
            : "Source download failed on the server"
        );
      });
  }, [sessionId, loadSession]);

  const isLive =
    session?.liveStatus === "live" || session?.liveStatus === "upcoming";
  const isActivelyLive = session?.liveStatus === "live";

  const recordedSeconds = useMemo(() => {
    const localDuration = Math.max(
      0,
      ...(session?.sourceMedia ?? []).map(
        (media) => media.durationSeconds ?? 0
      )
    );
    const captured = session?.liveRecording?.recordedSeconds ?? 0;
    const metadataDuration = session?.videoDurationSeconds ?? 0;

    // A completed local VOD has been probed from the actual file and should
    // beat stale platform/live-span metadata. Active streams still grow.
    if (!isLive && localDuration > 0) return localDuration;
    return Math.max(localDuration, captured, metadataDuration, recordedSecondsHint, 0);
  }, [isLive, recordedSecondsHint, session]);

  const playbackUrl = useMemo(() => {
    const media = session?.sourceMedia?.[0];
    return (
      media?.previewVideoUrl ??
      (media?.sourceIsPlayableMp4 ? media.sourceVideoUrl : null) ??
      null
    );
  }, [session]);

  const streamEnded =
    !isLive ||
    session?.liveRecording?.status === "completed" ||
    session?.liveStatus === "post_live" ||
    session?.liveStatus === "completed";

  const transcriptionBehind =
    recordedSeconds > 5 && transcribedSeconds < recordedSeconds - 15;

  // Caught up with the recording — do NOT also require MIN_TRANSCRIPT_SECONDS here.
  // That blocked short VODs at 100% forever (e.g. 40s stream needs 45s to "catch up").
  const transcriptionCaughtUp =
    recordedSeconds > 0 &&
    transcribedSeconds >= recordedSeconds * 0.92;

  const transcriptReady =
    (transcribedSeconds >= MIN_TRANSCRIPT_SECONDS &&
      (searchableChunks >= MIN_SEARCHABLE_CHUNKS || transcriptionCaughtUp)) ||
    // Short VODs / thin transcripts: once we're caught up, proceed anyway.
    (transcriptionCaughtUp &&
      (searchableChunks >= 1 ||
        recordedSeconds < MIN_TRANSCRIPT_SECONDS ||
        transcribedSeconds >= Math.min(recordedSeconds, 20)));

  // Keep the "finding" phase visible until clips arrive or we have a hard error.
  // (Previously suggestRequested flipped finding off while the request was still
  // in-flight or after a soft empty/stale state, which looked like a 100% hang.)
  const findingClips =
    suggesting ||
    (transcriptReady &&
      visibleClips.length === 0 &&
      !transcriptionError &&
      !suggestionError &&
      !wizard.suggestRequested);

  const awaitingSuggestRetry =
    transcriptReady &&
    visibleClips.length === 0 &&
    wizard.suggestRequested &&
    !suggesting &&
    !transcriptionError &&
    !suggestionError;

  const runSuggest = useCallback(
    async (opts?: {
      extra?: number;
      limit?: number;
      throughSeconds?: number;
    }): Promise<boolean> => {
      if (opts?.extra) setGetMoreLoading(true);
      else setSuggesting(true);
      setSuggestionError(null);
      try {
        const through = opts?.throughSeconds ?? transcribedSeconds;
        const { ok, data } = await fetchJson<{
          clips?: ClipSuggestionData[];
          wizard?: AgentWizardState;
          created?: number;
          error?: string;
          emptyReason?: string;
        }>(`/api/sessions/${sessionId}/suggest-clips`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(opts?.extra
              ? { extra: opts.extra }
              : { limit: opts?.limit ?? 10 }),
            throughSeconds: through,
            ...(isActivelyLive
              ? { cap: LIVE_NOW_SUGGESTION_CAP }
              : {}),
          }),
        });
        if (!ok) throw new Error(data.error ?? "Suggest failed");
        const nextClips = data.clips ?? [];
        setClips((current) => mergeClipSuggestions(current, nextClips));
        if (data.wizard) {
          const incomingWizard = data.wizard;
          setWizard((current) => ({
            ...current,
            cadence: current.cadence ?? incomingWizard.cadence,
            suggestRequested: incomingWizard.suggestRequested,
            lastSuggestThroughSeconds: Math.max(
              current.lastSuggestThroughSeconds,
              incomingWizard.lastSuggestThroughSeconds
            ),
            step:
              current.step === "transcribing" && incomingWizard.step === "pick"
                ? "pick"
                : current.step,
          }));
        }
        else {
          await persistWizard({
            step: "pick",
            suggestRequested: true,
            lastSuggestThroughSeconds: through,
          });
        }
        if (nextClips.length === 0) {
          throw new Error(
            data.emptyReason ??
              "No usable speech was found for clip suggestions. Check the transcript, then try again."
          );
        }
        if ((data.created ?? 0) > 0) {
          if (wizard.cadence === "live_now" && wizard.step !== "pick") {
            setUnseenLiveClips((count) => count + (data.created ?? 0));
          }
          setNewClipNotice(true);
          window.setTimeout(() => setNewClipNotice(false), 5000);
        }
        setTimeout(() => void loadSession().catch(() => {}), 2500);
        return true;
      } catch (err) {
        setSuggestionError(
          err instanceof Error ? err.message : "Failed to suggest clips"
        );
        return false;
      } finally {
        setSuggesting(false);
        setGetMoreLoading(false);
      }
    },
    [
      sessionId,
      persistWizard,
      loadSession,
      transcribedSeconds,
      wizard.cadence,
      wizard.step,
      isActivelyLive,
    ]
  );

  // Active streams always receive rolling suggestions. VODs use one batch.
  useEffect(() => {
    if (!session || loading) return;
    if (isActivelyLive && wizard.cadence !== "live_now") {
      void persistWizard({ cadence: "live_now" });
      return;
    }
    if (!isLive && !wizard.cadence) {
      void persistWizard({ cadence: "vod_batch" });
    }
  }, [session, loading, wizard.cadence, isLive, isActivelyLive, persistWizard]);

  // Keep capture duration and platform live status fresh in Agent Mode.
  useEffect(() => {
    if (!session?.id || !isLive) return;
    let cancelled = false;
    const tick = async () => {
      if (liveTickInFlight.current) return;
      liveTickInFlight.current = true;
      try {
        await fetchJson(`/api/sessions/${sessionId}/live-tick`, {
          method: "POST",
        });
        if (!cancelled) await loadSession();
      } catch {
        // Capture/transcription polling will retry independently.
      } finally {
        liveTickInFlight.current = false;
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), LIVE_TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [session?.id, sessionId, isLive, loadSession]);

  useEffect(() => {
    if (!session?.id) return;

    let cancelled = false;
    const tick = async () => {
      if (transcribeInFlight.current) return;
      transcribeInFlight.current = true;
      try {
        const { ok, data } = await fetchJson<{
          error?: string;
          transcribedThrough?: number;
          recordedSeconds?: number;
          searchableChunks?: number;
        }>(`/api/sessions/${sessionId}/transcribe`, { method: "POST" });

        if (cancelled) return;

        if (!ok) {
          if (data.error?.toLowerCase().includes("enough audio")) {
            setTranscriptionError("Waiting for enough audio to transcribe…");
          } else if (data.error) {
            setTranscriptionError(data.error);
          }
          return;
        }

        setTranscriptionError(null);
        if (typeof data.transcribedThrough === "number") {
          setTranscribedSeconds((current) =>
            Math.max(current, data.transcribedThrough ?? 0)
          );
        }
        if (typeof data.recordedSeconds === "number") {
          setRecordedSecondsHint((current) =>
            Math.max(current, data.recordedSeconds ?? 0)
          );
        }

        // Agent transcription returns its readiness aggregate in the same response.
        if (typeof data.searchableChunks === "number") {
          setSearchableChunks(data.searchableChunks);
        }
      } catch {
        // worker may still be progressing
      } finally {
        transcribeInFlight.current = false;
      }
    };

    void tick();
    const ms = transcriptionBehind
      ? TRANSCRIPTION_FAST_TICK_MS
      : TRANSCRIPTION_SLOW_TICK_MS;
    const id = setInterval(() => void tick(), ms);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    sessionId,
    session?.id,
    transcriptionBehind,
    transcribedSeconds,
  ]);

  // Observe committed transcript chunks while the longer POST request is still
  // transcribing. This keeps time and percentage moving instead of updating in bursts.
  useEffect(() => {
    if (!session?.id) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { ok, data } = await fetchJson<{
          recordedSeconds?: number;
          transcribedSeconds?: number;
          searchableChunks?: number;
        }>(`/api/sessions/${sessionId}/transcribe`);
        if (!cancelled && ok) {
          setRecordedSecondsHint((current) =>
            Math.max(current, data.recordedSeconds ?? 0)
          );
          setTranscribedSeconds((current) =>
            Math.max(current, data.transcribedSeconds ?? 0)
          );
          setSearchableChunks((current) =>
            Math.max(current, data.searchableChunks ?? 0)
          );
        }
      } catch {
        // The POST worker remains authoritative; the next read will catch up.
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session?.id, sessionId]);

  // Refresh source state while an upload/download is becoming playable.
  useEffect(() => {
    if (!session?.id || playbackUrl) return;
    const timer = window.setInterval(() => {
      void loadSession().catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [loadSession, playbackUrl, session?.id]);

  useEffect(() => {
    if (!wizard.cadence) return;
    if (wizard.cadence === "after_stream" && !streamEnded) return;
    if (!transcriptReady) return;
    if (transcriptionError || suggestionError) return;

    if (wizard.cadence === "live_now") {
      const last = wizard.lastSuggestThroughSeconds ?? 0;
      const needFirst = !wizard.suggestRequested;
      const needRoll =
        wizard.suggestRequested &&
        transcribedSeconds - last >= LIVE_NOW_ROLL_SECONDS;
      if (!needFirst && !needRoll) return;
      if (rollingInFlight.current || suggesting || getMoreLoading) return;

      if (visibleClips.length >= LIVE_NOW_SUGGESTION_CAP) return;

      rollingInFlight.current = true;
      void runSuggest({
        ...(needFirst ? { limit: 6 } : { extra: 2 }),
        throughSeconds: transcribedSeconds,
      }).finally(() => {
        rollingInFlight.current = false;
      });
      return;
    }

    // vod_batch or after_stream (stream ended)
    if (suggesting || getMoreLoading) return;
    if (wizard.suggestRequested) {
      const last = wizard.lastSuggestThroughSeconds ?? 0;
      const newCoverage = transcribedSeconds - last;
      const shouldRoll =
        visibleClips.length < 10 &&
        (newCoverage >= VOD_SUGGEST_ROLL_SECONDS ||
          (transcriptionCaughtUp && newCoverage >= 2));
      if (!shouldRoll || rollingInFlight.current) return;

      rollingInFlight.current = true;
      void runSuggest({
        extra: Math.min(5, Math.max(1, 10 - visibleClips.length)),
        throughSeconds: transcribedSeconds,
      }).finally(() => {
        rollingInFlight.current = false;
      });
      return;
    }

    if (visibleClips.length >= 10) {
      if (!wizard.suggestRequested) {
        void persistWizard({
          step: "pick",
          suggestRequested: true,
          lastSuggestThroughSeconds: transcribedSeconds,
        });
      }
      return;
    }

    if (suggestStarted.current) return;

    suggestStarted.current = true;
    void runSuggest({ throughSeconds: transcribedSeconds }).then((ok) => {
      if (!ok) {
        suggestStarted.current = false;
        // Allow another attempt after clearing the sticky flag if it was set.
        void persistWizard({ suggestRequested: false });
      }
    });
  }, [
    wizard.cadence,
    wizard.suggestRequested,
    wizard.lastSuggestThroughSeconds,
    streamEnded,
    transcriptReady,
    transcriptionCaughtUp,
    transcribedSeconds,
    visibleClips.length,
    suggesting,
    getMoreLoading,
    transcriptionError,
    suggestionError,
    runSuggest,
    persistWizard,
  ]);

  // Live mode treats provider failures as transient and retries the same wave.
  useEffect(() => {
    if (wizard.cadence !== "live_now" || !suggestionError) return;
    const id = window.setTimeout(() => setSuggestionError(null), 20_000);
    return () => window.clearTimeout(id);
  }, [wizard.cadence, suggestionError]);

  // Watchdog: at ~100% transcript with no clips and no in-flight suggest, force a try.
  useEffect(() => {
    if (!wizard.cadence) return;
    if (wizard.cadence === "after_stream" && !streamEnded) return;
    if (!transcriptionCaughtUp || visibleClips.length > 0) return;
    if (
      suggesting ||
      getMoreLoading ||
      transcriptionError ||
      suggestionError
    ) {
      return;
    }

    const id = window.setTimeout(() => {
      if (suggestStarted.current || suggesting) return;
      suggestStarted.current = true;
      void (async () => {
        if (wizard.suggestRequested) {
          await persistWizard({
            step: "transcribing",
            suggestRequested: false,
          });
        }
        const ok = await runSuggest({ throughSeconds: transcribedSeconds });
        if (!ok) {
          suggestStarted.current = false;
          await persistWizard({ suggestRequested: false });
        }
      })();
    }, 2500);
    return () => window.clearTimeout(id);
  }, [
    wizard.cadence,
    wizard.suggestRequested,
    streamEnded,
    transcriptionCaughtUp,
    visibleClips.length,
    suggesting,
    getMoreLoading,
    transcriptionError,
    suggestionError,
    transcribedSeconds,
    runSuggest,
    persistWizard,
  ]);

  const activeClipId =
    wizard.selectedClipIds[wizard.queueIndex] ?? null;
  const activeClip = clips.find((c) => c.id === activeClipId) ?? null;
  const displayStep = resolveAgentDisplayStep({
    step: wizard.step,
    hasVisibleClips: visibleClips.length > 0,
    hasActiveClip: Boolean(activeClip),
  });
  const studioClip = studioClipId
    ? clips.find((c) => c.id === studioClipId) ?? null
    : null;

  async function handleDeleteSession() {
    const size = session?.storageLabel ? ` (${session.storageLabel})` : "";
    if (
      !window.confirm(
        `Delete this session and free disk space${size}?\n\nRemoves local recordings and rendered clips.`
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const { ok, data } = await fetchJson<{ error?: string }>(
        `/api/sessions/${sessionId}`,
        { method: "DELETE" }
      );
      if (!ok) throw new Error(data.error ?? "Delete failed");
      posthog.capture("session_deleted", {
        session_id: sessionId,
        mode: "agent",
      });
      router.push("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  async function continueFromEdit() {
    await persistWizard({
      step: "export",
      includeCaptions: wizard.includeCaptions,
    });
  }

  async function renderActiveClip() {
    if (!activeClip) return;
    setExporting(true);
    setExportError(null);
    setExportDoneUrl(null);
    setExportProgress(5);
    setExportStage("queued");
    posthog.capture("agent_clip_export", {
      session_id: sessionId,
      clip_id: activeClip.id,
      look_preset: wizard.lookPreset ?? "auto",
    });

    try {
      // Prefer the auto-prepared (or user-overridden) saved layout.
      const layoutRes = await fetchJson<{
        configuration?: {
          layout: string;
          faceAnalysisJobId?: string | null;
          faceSelection?: VerticalLayoutSelection["faceSelection"];
          settings?: Record<string, unknown>;
        } | null;
      }>(`/api/clips/${activeClip.id}/vertical-layout`);

      let selection: VerticalLayoutSelection;
      const config = layoutRes.ok ? layoutRes.data.configuration : null;
      if (config) {
        const base = defaultVerticalLayoutSelection();
        const settings = (config.settings ?? {}) as Partial<
          VerticalLayoutSelection
        >;
        selection = {
          ...base,
          ...settings,
          layout: (config.layout as VerticalLayoutSelection["layout"]) ?? "auto",
          faceAnalysisJobId: config.faceAnalysisJobId ?? undefined,
          faceSelection: config.faceSelection ?? { mode: "auto" },
          captions: {
            enabled: wizard.includeCaptions,
            position: settings.captions?.position ?? "lower",
          },
        };
      } else {
        selection = buildVerticalSelection(
          wizard.lookPreset ?? "auto",
          wizard.faceAnalysisJobId,
          wizard.includeCaptions
        );
      }

      const result = await renderClip(
        activeClip.id,
        "vertical",
        wizard.includeCaptions,
        captionAppearance,
        undefined,
        (update) => {
          setExportProgress((current) => Math.max(current, update.progress));
          setExportStage(
            update.progress >= 94 && update.status !== "completed"
              ? "quality_check"
              : update.status
          );
        },
        undefined,
        undefined,
        selection
      );

      const url = result.downloadUrl;
      setExportDoneUrl(url);
      setClips((prev) =>
        prev.map((c) =>
          c.id === activeClip.id ? { ...c, status: "rendered" } : c
        )
      );
      await triggerFileDownload(
        url,
        `${activeClip.title.slice(0, 40) || "short"}.mp4`
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Render failed");
    } finally {
      setExporting(false);
    }
  }

  async function advanceQueue() {
    const nextIndex = wizard.queueIndex + 1;
    if (nextIndex >= wizard.selectedClipIds.length) {
      await persistWizard({ step: "done" });
      return;
    }
    await persistWizard({
      step: "edit",
      queueIndex: nextIndex,
      lookPreset: "auto",
      faceAnalysisJobId: null,
    });
    setExportDoneUrl(null);
    setExportError(null);
  }

  async function handleSend() {
    const text = prompt.trim();
    if (!text || sending) return;
    if (!transcriptReady) {
      setTurns((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          text: `Still ingesting transcript (${formatSeconds(transcribedSeconds)} ready). Try again once more of the stream is transcribed.`,
          error: true,
        },
      ]);
      return;
    }

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
    };
    setTurns((prev) => [...prev, userTurn]);
    setPrompt("");
    setSending(true);
    posthog.capture("agent_clip_request", { session_id: sessionId });

    try {
      const { ok, data } = await fetchJson<{
        found?: boolean;
        answer?: string;
        clip?: ClipSuggestionData;
        error?: string;
      }>(`/api/sessions/${sessionId}/find-clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: text,
          autoRender: false,
          includeCaptions: wizard.includeCaptions,
          captionAppearance,
        }),
      });

      if (!ok && data.error) throw new Error(data.error);

      if (data.found === false || !data.clip) {
        setTurns((prev) => [
          ...prev,
          {
            id: `asst-${Date.now()}`,
            role: "assistant",
            text:
              data.answer ??
              "I couldn't find that moment yet. Try quoting words from the stream.",
          },
        ]);
        return;
      }

      const clip = data.clip;
      setClips((prev) => {
        const without = prev.filter((c) => c.id !== clip.id);
        return [clip, ...without];
      });
      setTurns((prev) => [
        ...prev,
        {
          id: `asst-${Date.now()}`,
          role: "assistant",
          text:
            data.answer ??
            `Found “${clip.title}” and added it to your pick list.`,
          clip,
        },
      ]);
      if (wizard.step === "pick" || wizard.step === "transcribing") {
        await persistWizard({ step: "pick", suggestRequested: true });
      }
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          text: err instanceof Error ? err.message : "Find clip failed",
          error: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="editor-shell agent-shell flex min-h-screen flex-col bg-[#07090b]">
        <EditorHeader
          title="Agent"
          mode="agent"
          modeSwitching={modeSwitching}
          onModeChange={onModeChange}
        />
        <div className="flex flex-1 items-center justify-center px-6">
          <OperationProgress
            title="Opening Agent Mode"
            stages={[
              "Loading the session…",
              "Checking source media…",
              "Restoring your clip workspace…",
            ]}
            className="max-w-sm"
          />
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="editor-shell agent-shell flex min-h-screen flex-col bg-[#07090b]">
        <EditorHeader
          title="Agent"
          mode="agent"
          modeSwitching={modeSwitching}
          onModeChange={onModeChange}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <p className="text-[var(--color-danger)]">{error ?? "Session not found"}</p>
          <Link href="/" className="text-[var(--color-accent)] text-sm hover:underline">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const progressPct =
    recordedSeconds > 0
      ? Math.min(100, Math.round((transcribedSeconds / recordedSeconds) * 100))
      : 0;

  return (
    <div className="editor-shell agent-shell flex h-screen flex-col overflow-hidden bg-[#07090b]">
      <EditorHeader
        title={session.title}
        mode="agent"
        storageLabel={session.storageLabel}
        isLive={isLive}
        recordedSeconds={recordedSeconds}
        deleting={deleting}
        onDelete={handleDeleteSession}
        modeSwitching={modeSwitching}
        onModeChange={onModeChange}
      />

      {isActivelyLive && unseenLiveClips > 0 && displayStep !== "pick" && (
        <button
          type="button"
          onClick={() => {
            setUnseenLiveClips(0);
            void persistWizard({ step: "pick" });
          }}
          className="shrink-0 border-b border-[#65d8c1]/25 bg-[#65d8c1]/[0.08] px-4 py-2 text-left text-xs font-semibold text-[#8ee9d5] hover:bg-[#65d8c1]/[0.12]"
        >
          {unseenLiveClips} new live clip suggestion
          {unseenLiveClips === 1 ? "" : "s"} · View suggestions
        </button>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          {wizard.cadence === "after_stream" &&
            !streamEnded && (
            <div className="mx-auto flex w-full max-w-lg flex-col justify-center py-16">
              <TranscriptionProgressCard
                transcribedSeconds={transcribedSeconds}
                recordedSeconds={recordedSeconds}
                progressPct={progressPct}
                transcriptionError={sourceError ?? transcriptionError}
                phase="transcribing"
              />
            </div>
          )}

          {!(wizard.cadence === "after_stream" && !streamEnded) &&
            visibleClips.length === 0 &&
            (displayStep === "transcribing" || displayStep === "pick") &&
            (findingClips ||
              awaitingSuggestRetry ||
              !transcriptReady ||
              Boolean(transcriptionError) ||
              Boolean(suggestionError) ||
              suggesting) &&
            (
            <div className="mx-auto flex w-full max-w-lg flex-col justify-center gap-4 py-16">
              <TranscriptionProgressCard
                transcribedSeconds={transcribedSeconds}
                recordedSeconds={recordedSeconds}
                progressPct={progressPct}
                transcriptionError={sourceError ?? transcriptionError ?? suggestionError}
                phase={
                  findingClips || suggesting || awaitingSuggestRetry
                    ? "finding_clips"
                    : "transcribing"
                }
              />
              {!suggesting && (transcriptionError || suggestionError) && (
                <Button
                  type="button"
                  onClick={() => {
                    suggestStarted.current = false;
                    setTranscriptionError(null);
                    setSuggestionError(null);
                    void persistWizard({ suggestRequested: false });
                    void runSuggest({ throughSeconds: transcribedSeconds });
                  }}
                >
                  Retry finding clips
                </Button>
              )}
            </div>
          )}

          {displayStep === "pick" &&
            !findingClips &&
            !suggesting &&
            (transcriptReady ||
              visibleClips.length > 0 ||
              wizard.suggestRequested) &&
            !(wizard.cadence === "after_stream" && !streamEnded) && (
            <div className="space-y-4">
              {newClipNotice && (
                <p className="rounded border border-[#65d8c1]/30 bg-[#65d8c1]/10 px-3 py-2 text-xs text-[#8ee9d5]">
                  New clip suggestion
                  {wizard.cadence === "live_now" ? " — still watching the live stream" : ""}
                </p>
              )}
              {wizard.cadence === "live_now" && isLive && (
                <div className="flex items-center gap-2 border-l-2 border-[#65d8c1] bg-[#65d8c1]/[0.06] px-3 py-2 text-xs text-[#aeb9b8]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#65d8c1]" />
                  New moments are added to the top while the stream continues.
                </div>
              )}
              <AgentClipPickGrid
                clips={withThumbnails(
                  sessionId,
                  visibleClips
                )}
                onOpenClip={(id) => {
                  setStudioClipId(id);
                }}
                onGetMore={() =>
                  void runSuggest({
                    extra: 5,
                    throughSeconds: transcribedSeconds,
                  })
                }
                getMoreLoading={getMoreLoading}
                suggesting={suggesting}
                isLive={Boolean(isLive)}
                onOpenAssistant={() => setShowFindChat(true)}
                sessionId={sessionId}
                playbackUrl={playbackUrl}
              />
              {!showFindChat && (
                <button
                  type="button"
                  onClick={() => setShowFindChat(true)}
                  className="fixed bottom-6 right-6 z-30 flex h-12 items-center gap-2 rounded-md border border-[#f0b75a] bg-[#f0b75a] px-4 text-sm font-semibold text-[#1b1203] shadow-[0_16px_44px_rgba(0,0,0,0.4)] transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-[#f7c974] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0b75a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#07090b]"
                >
                  <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                  Find a specific moment
                </button>
              )}
            </div>
          )}

          {displayStep === "look" && activeClip && (
            <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 py-16 text-center">
              <p className="text-sm text-[var(--color-muted)]">
                Looks are applied automatically from face detection. Open a clip
                from Pick to change the look, or continue editing.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void persistWizard({ step: "pick" })}
                >
                  Back to picks
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    void persistWizard({
                      step: "edit",
                      lookPreset: wizard.lookPreset ?? "auto",
                    })
                  }
                >
                  Continue to edit
                </Button>
              </div>
            </div>
          )}

          {displayStep === "edit" && activeClip && (
            <div className="mx-auto w-full max-w-4xl space-y-4">
              <AgentClipEditor
                sessionId={sessionId}
                clip={activeClip}
                playbackUrl={playbackUrl}
                sourceDuration={recordedSeconds}
                includeCaptions={wizard.includeCaptions}
                onIncludeCaptionsChange={(value) => {
                  void persistWizard({ includeCaptions: value });
                }}
                captionAppearance={captionAppearance}
                onCaptionAppearanceChange={(next) => {
                  setCaptionAppearance(next);
                  writeCaptionAppearancePreference(next);
                }}
                onClipChange={(next) => {
                  setClips((prev) =>
                    prev.map((c) => (c.id === next.id ? next : c))
                  );
                }}
              />
              <div className="flex justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void persistWizard({ step: "pick" })}
                >
                  Back to picks
                </Button>
                <Button type="button" onClick={() => void continueFromEdit()}>
                  Continue to export
                </Button>
              </div>
            </div>
          )}

          {displayStep === "export" && activeClip && (
            <div className="mx-auto w-full max-w-lg space-y-4 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-6">
              <h2 className="text-lg font-semibold">Export</h2>
              <p className="text-sm text-[var(--color-muted)]">
                Render “{activeClip.title}” as a vertical Short with auto face
                positioning
                {wizard.includeCaptions ? " and captions" : ""}. Change the look
                anytime by opening the clip from Pick.
              </p>
              {exportError && (
                <p className="text-sm text-[var(--color-danger)]">{exportError}</p>
              )}
              {exportDoneUrl && (
                <p className="text-sm text-[var(--color-accent)]">
                  Render ready — download started.
                </p>
              )}
              {exporting && (
                <OperationProgress
                  title={
                    exportStage === "quality_check"
                      ? "Reviewing export"
                      : "Rendering your video"
                  }
                  detail={
                    exportStage === "queued"
                      ? "Waiting for the render worker…"
                      : exportStage === "quality_check"
                        ? "Checking framing, captions, and output quality…"
                        : "Encoding the final high-quality video…"
                  }
                  progress={exportProgress > 0 ? exportProgress : null}
                  resetKey={`${activeClip.id}:agent-export`}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void persistWizard({ step: "edit" })}
                >
                  Back to edit
                </Button>
                <Button
                  type="button"
                  disabled={exporting}
                  onClick={() => void renderActiveClip()}
                >
                  {exporting ? "Rendering…" : exportDoneUrl ? "Render again" : "Render & download"}
                </Button>
                {exportDoneUrl && (
                  <Button type="button" onClick={() => void advanceQueue()}>
                    {wizard.queueIndex + 1 >= wizard.selectedClipIds.length
                      ? "Finish"
                      : "Next clip"}
                  </Button>
                )}
              </div>
            </div>
          )}

          {displayStep === "done" && (
            <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
              <h2 className="text-xl font-semibold">All set</h2>
              <p className="text-sm text-[var(--color-muted)]">
                You finished the selected clips. Pick more from the grid or find
                another moment.
              </p>
              <Button
                type="button"
                onClick={() =>
                  void persistWizard({
                    step: "pick",
                    queueIndex: 0,
                    lookPreset: null,
                    faceAnalysisJobId: null,
                  })
                }
              >
                Back to clip picks
              </Button>
            </div>
          )}

          {(showFindChat || displayStep === "pick") && showFindChat && (
            <div className="fixed bottom-5 right-5 z-40 isolate flex max-h-[min(620px,calc(100vh-2.5rem))] w-[min(410px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-[#3b4248] bg-[#0a0d0f] shadow-[0_28px_90px_rgba(0,0,0,0.92),0_0_0_1px_rgba(255,255,255,0.04)]">
              <div className="flex shrink-0 items-center justify-between border-b border-[#30363c] bg-[#111519] px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-md bg-[#f0b75a] text-[#1b1203]">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-foreground)]">
                      Moment assistant
                    </p>
                    <p className="text-[11px] text-[var(--color-muted)]">
                      Describe it. Clipper finds it.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFindChat(false)}
                  className="grid h-8 w-8 place-items-center text-[var(--color-muted)] transition-colors hover:bg-white/5 hover:text-[var(--color-foreground)]"
                  aria-label="Close moment assistant"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="relative min-h-[220px] flex-1 overflow-hidden bg-[#0a0d0f]">
                <ChatContainerRoot className="h-full bg-[#0a0d0f] px-3">
                  <ChatContainerContent className="space-y-4 py-4">
                    {turns.length === 0 && (
                      <Message>
                        <MessageAvatar src="" alt="Clipper" fallback="C" />
                        <MessageContent className="border border-[#30363c] bg-[#181d21] text-sm text-[#f4f2eb]">
                          Describe a moment to add another clip to your list.
                        </MessageContent>
                      </Message>
                    )}
                    {turns.map((turn) =>
                      turn.role === "user" ? (
                        <Message key={turn.id} className="justify-end">
                          <MessageContent className="bg-[#95ff00] text-[#071000]">
                            {turn.text}
                          </MessageContent>
                        </Message>
                      ) : (
                        <Message key={turn.id}>
                          <MessageAvatar src="" alt="Agent" fallback="AI" />
                          <MessageContent
                            className={cn(
                              "text-sm",
                              turn.error
                                ? "border border-destructive/40 bg-[#1a0808] text-[#ffb4b4]"
                                : "border border-[#30363c] bg-[#181d21] text-[#f4f2eb]"
                            )}
                          >
                            {turn.text}
                          </MessageContent>
                        </Message>
                      )
                    )}
                    <ChatContainerScrollAnchor />
                  </ChatContainerContent>
                </ChatContainerRoot>
              </div>
              <div className="shrink-0 border-t border-[#30363c] bg-[#111519] p-3">
                {turns.length === 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {[
                      "The funniest reaction",
                      "When they talked about pricing",
                      "The comeback near the end",
                    ].map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => setPrompt(example)}
                        className="border border-[#343b41] bg-[#0a0d0f] px-2.5 py-1.5 text-left text-[11px] text-[#abb2b7] transition-colors hover:border-[var(--color-accent)]/60 hover:text-white"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                )}
                <PromptInput
                  value={prompt}
                  onValueChange={setPrompt}
                  isLoading={sending}
                  onSubmit={() => void handleSend()}
                  className="border-[#3b4248] bg-[#080a0c] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                  <PromptInputTextarea
                    placeholder="Describe the clip…"
                    className="text-[#f4f2eb] placeholder:text-[#737c82]"
                  />
                  <PromptInputActions className="justify-end pt-1">
                    <PromptInputAction tooltip="Send">
                      <Button
                        type="button"
                        size="icon"
                        disabled={sending || !prompt.trim()}
                        onClick={() => void handleSend()}
                        className="h-9 w-9 rounded-full"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                    </PromptInputAction>
                  </PromptInputActions>
                </PromptInput>
              </div>
            </div>
          )}
        </section>

      </div>

      {studioClip && (
        <AgentClipStudioModal
          open={Boolean(studioClipId)}
          sessionId={sessionId}
          clip={studioClip}
          playbackUrl={playbackUrl}
          sourceDuration={recordedSeconds}
          includeCaptions={wizard.includeCaptions}
          captionAppearance={captionAppearance}
          onIncludeCaptionsChange={(value) => {
            void persistWizard({ includeCaptions: value });
          }}
          onCaptionAppearanceChange={(next) => {
            setCaptionAppearance(next);
            writeCaptionAppearancePreference(next);
          }}
          onClipChange={(next) => {
            setClips((prev) =>
              prev.map((c) => (c.id === next.id ? next : c))
            );
          }}
          onClose={() => setStudioClipId(null)}
        />
      )}
    </div>
  );
}

function buildVerticalSelection(
  presetId: ContentLookPresetId,
  faceAnalysisJobId: string | null,
  captionsEnabled: boolean
): VerticalLayoutSelection {
  const preset = getContentLookPreset(presetId);
  const base = defaultVerticalLayoutSelection();
  return {
    ...base,
    layout: preset.layout,
    faceAnalysisJobId: faceAnalysisJobId ?? undefined,
    faceSelection: { mode: "auto" },
    stacked: {
      ...base.stacked,
      facecamPosition: "top",
      facecamHeightRatio: presetId === "gaming" ? 0.34 : base.stacked.facecamHeightRatio,
      hideOriginalFacecam: presetId === "gaming" ? "crop_out" : "none",
    },
    pip: {
      ...base.pip,
      hideOriginalFacecam: presetId === "podcast" ? "blur" : "none",
    },
    captions: {
      enabled: captionsEnabled,
      position: "lower",
    },
  };
}

const FINDING_CLIP_TIPS = [
  "Scoring punchy moments…",
  "Ranking by clip-worthiness…",
  "Picking titles and thumbnails…",
  "Almost there…",
] as const;

function TranscriptionProgressCard({
  transcribedSeconds,
  recordedSeconds,
  progressPct,
  transcriptionError,
  phase = "transcribing",
}: {
  transcribedSeconds: number;
  recordedSeconds: number;
  progressPct: number;
  transcriptionError: string | null;
  phase?: "transcribing" | "finding_clips";
}) {
  const finding = phase === "finding_clips";
  return (
    <div className="w-full space-y-3 border-y border-white/[0.09] py-4 text-left">
      <OperationProgress
        title={finding ? "Finding the strongest moments" : "Preparing your video"}
        detail={
          recordedSeconds > 0
            ? `${formatSeconds(transcribedSeconds)} of ${formatSeconds(recordedSeconds)} ready`
            : "Reading source media and waiting for the first transcript chunk…"
        }
        progress={finding || recordedSeconds <= 0 ? null : progressPct}
        stages={
          finding
            ? FINDING_CLIP_TIPS
            : recordedSeconds > 0
              ? []
              : [
                  "Reading source media…",
                  "Extracting the first audio window…",
                  "Starting transcription…",
                ]
        }
        resetKey={phase}
      />

      {transcriptionError && (
        <p className="text-[11px] text-[var(--color-warning,#e6b84d)]">
          {transcriptionError}
        </p>
      )}
    </div>
  );
}
