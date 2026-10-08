# Clipper AI calls and spending choices

Audit date: October 8, 2026. This inventory comes from application code, not a provider billing export. Counts describe successful application requests; provider fallbacks, retries, configured overrides, and cache hits change actual usage. A call with video or many images can cost much more than a text call. No dollar savings are claimed without billing data.

## Cuts implemented

| Task | Previous behavior | New behavior |
| --- | --- | --- |
| Candidate ranking and title critic | One ranking call, then another AI title review; both assign scores | No AI calls. Existing local transcript, boundary, audio, chat, and visual heuristics select moments |
| Hook judging | One batch judge call even in default shadow mode; possible fallback model; creates and scores more titles | Local opening selection by default; no automatic paid judging |
| Final titles/descriptions | For ten clips: two writer calls and two reviewer calls, up to eight calls with repair attempts | One writer request for the whole selected batch, up to 25 clips. Standard chat model rather than the strong hook model. No critic, scores, alternatives, or repair requests |
| Studio platform defaults | Every opening requests all eight platforms separately; each asks for 12–16 scored packages | Zero AI calls. All platforms adapt the saved title/description locally |
| Ordinary platform export and non-Reddit social copy | Can generate more packages for each platform | Reuse saved clip copy and adapt locally |
| Explicit platform-copy regeneration | 12–16 scored alternatives from a strong model, up to its configured output limit | One package, one request, no model scores, standard/cheap route, 1,200 output-token cap |
| Render AI scoring | AI frame critic runs after exports and previews by default | Disabled by default; technical file/audio/duration checks remain. Explicit server opt-in can re-enable it |
| Cached caption direction | Automatic fallback plans could prompt AI again on reopening | Any valid plan is reused; changed cues or an explicit force still invalidate it |

For the normal ten-clip discovery path, the text ranking/hook/editorial stages previously made up to seven successful calls before repairs: ranking + title critic + hook judge + four editorial calls. Now these stages make one writer call. This excludes vision, speech transcription, and caption styling. Eight platform requests per Studio opening are also removed, independent of how many tabs the user actually visits.

Local checks still reject malformed copy, repeated titles, transcript spans, duplicated descriptions, and evidence absent from the selected clip. They do not provide the semantic assurance of a second AI reviewer. This is the deliberate quality/cost tradeoff requested. Bad entries are omitted; transcript fragments are never substituted. Existing picks remain until replacement generation succeeds. Provider credit failures are still reported, with a configured direct-OpenAI fallback where available.

## Complete paid-call inventory

| Case | Trigger and repeat pattern | Status / next decision | Source |
| --- | --- | --- | --- |
| Source speech transcription | Audio chunks: ordinarily 45 seconds for VOD processing; agent chunks can be 90 seconds. Deepgram or Whisper, with provider fallback/retries | Keep: supplies captions and transcript-based discovery. Longer chunks reduce request count but not necessarily billed audio minutes | `services/transcriptionSyncService.ts`, `services/transcriptionRouterService.ts`, `services/deepgramTranscription.ts`, `services/whisperTranscription.ts` |
| Additional transcription quality pass | Direct OpenAI timing transcription can be followed by a second audio request when a quality model is configured | Optional; off for the global quality model when no model is configured | `lib/aiProvider.ts`, `services/whisperTranscription.ts` |
| Selected-clip caption refinement | Studio/preview/export can refine a clip using overlapping roughly 18-second windows. Each window uses timing transcription plus the configured quality model. A one-minute clip can mean about eight audio requests; a two-minute clip about fourteen, before retries. Cache is keyed by range/source/model | Major remaining multiplier. Consider manual “Improve captions” only, or a single timing pass. Preserve current behavior until selected | `services/clipTranscriptRefinementService.ts`, `services/accurateClipTranscriptionService.ts` |
| Candidate visual understanding | During discovery, bounded by a candidate budget (default maximum ten). Each selected candidate sends a screenshot sequence, ordinarily 24–36 images. Ambiguous clips can escalate to a short video request with Gemini. Context is cached | Consider removing this discovery pass and retaining selected-clip framing only | `services/visualContextService.ts`, `services/visualAnalysisBudgetService.ts` |
| Selected-clip framing understanding | Face-analysis jobs can send another clip-specific sequence, with 40–48 image coverage. Automatic suggestion preparation starts these jobs before Studio. Its range/cache differs from discovery analysis. Framing reserves additional budget, so the stream budget is not a hard global spending cap | Consider on-demand Studio analysis; reuse result for previews/downloads. Local face detection/tracking itself makes no paid model request | `services/faceAnalysisService.ts`, `services/clipAutoPrepareService.ts`, `services/visualContextService.ts` |
| Candidate AI ranking/title critic | Two text calls for ranking, narrative selection, title rewriting, and scoring | Removed from automatic discovery | `services/clipRankingService.ts`, `services/suggestClipsService.ts` |
| Hook judge/title alternatives | Batch model judgment, scored title alternatives, optional fallback model | Automatic use removed; service retains an explicit opt-in for deliberate use | `services/hookEngineService.ts` |
| Final clip copy | Selected excerpts, identities, and available verified visual context | One batch request; no second AI review or automatic repair | `services/clipEditorialService.ts` |
| Caption style direction | One text call assigning emphasis/roles to transcript cues; automatic warmup runs for up to six clips, and Studio also requests direction. Output is cached against cues | Good candidate to disable AI styling and retain local automatic emphasis; this is separate from speech recognition/accuracy | `services/captionDirectorService.ts` |
| Render visual critic | Sends sampled frames after renders, including previews by default. It scores output and can trigger a framing repair and another render/review | AI critic and preview review now default off. Technical checks remain; explicit server flags can enable AI criticism | `services/postRenderCriticService.ts`, `services/renderService.ts` |
| Platform copy | Studio, exports, publishing, or explicit regenerate | Automatic copy now local; explicit regenerate makes one unscored request | `services/platformCopyService.ts`, `services/platformExportService.ts` |
| Social post generation | Non-Reddit platforms reuse platform copy; Reddit has a separate text request. A failed common-platform adaptation can also reach the social fallback request | Non-Reddit normal path now local; Reddit remains paid when requested | `services/social/socialContentGenerationService.ts` |
| Manual metadata endpoint | The session clip metadata endpoint requests one title, description, and hashtags for a chosen range | Separate on-demand endpoint; not part of ordinary automatic suggestion naming | `services/clipMetadataService.ts`, `lib/ai.ts` |
| Find a moment by description | Keyword/retrieval path may answer locally; AI matching makes one text request when needed | Keep on user request; cap responses and cache repeated requests if usage warrants | `services/findClipService.ts`, `lib/ai.ts` |
| Ask about the stream | Keyword fast path can avoid AI. Otherwise one answer call, with a possible second call if JSON is invalid | On demand; keyword fast path is already enabled | `app/api/sessions/[sessionId]/ask/route.ts`, `lib/ai.ts`, `lib/aiCostConstants.ts` |
| Embeddings | Transcript ingest, chat-window ingest, or vector question search have embedding call sites | All three are disabled by current code defaults; do not count them as active spend without checking configuration/code changes | `lib/embeddings.ts`, `lib/aiCostConstants.ts`, `lib/rag.ts`, `services/transcriptService.ts`, `services/transcriptionSyncService.ts`, `services/eventWindowService.ts` |
| Chat-window summary helper | Named AI helper exists | No paid call: currently returns its supplied local summary | `lib/ai.ts` |

## Suggested next cuts to discuss

1. **Keep render AI scoring off.** It now defaults off, including preview reviews. Keep FFmpeg/file/audio/duration checks. This gives up automatic visual criticism/repair; existing explicit server opt-ins still take precedence.
2. **Turn off AI caption styling.** Keep transcription and local emphasis rules. Removes up to six warmup text calls plus invalidated-plan calls.
3. **Run vision only for clips opened in Studio or selected for autopilot export.** Stop analyzing discarded candidates and unopened suggested clips. Keep face-aware tracking and export reuse.
4. **Make expensive caption refinement explicit.** Use the source transcript by default, with an “Improve captions” action for the chosen clip. This can avoid many overlapping audio requests, with a caption-accuracy tradeoff.
5. **Reuse one vision result per exact source/range**, with content-based cache keys independent of candidate IDs/purpose, and deduplicate concurrent requests. Avoid discovery/framing analysis of the same footage twice.
6. **Put explicit output-token limits on vision and remaining older chat endpoints.** The screenshot path currently omits `max_tokens`; previous OpenRouter errors showed a 65,535-token reservation. A smaller cap reduces reservations and worst-case output, but is not itself a measured billing reduction. Dense framing responses need enough space to remain valid.

The code's visual budget uses estimated per-call costs, not provider-reported actual token charges. A true dollar cap requires recording provider usage/costs and enforcing a shared budget across vision, audio, text, previews, and retries. Existing hook metadata alone does not provide complete spend accounting.
