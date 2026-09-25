# Speaker intelligence architecture

## Existing-system audit

Clipper already had two transcription paths: Deepgram Nova-3 for low-latency work and Whisper/OpenAI for VOD and final caption refinement. Deepgram word objects retained a provider-local `speaker` field, but diarization was opt-in and the caption model removed that field. Final OpenAI refinement replaced diarized words with non-diarized words. As a result, neither the browser caption planner nor ASS renderer knew which speaker owned a phrase.

Face analysis already produces stable tracks, lower-face activity, audio activity, scene changes, and a professional virtual-camera plan. The active-speaker heuristic correlated global audio with mouth movement, but it had no audible speaker identity. An off-screen voice could therefore be associated with a visible reaction. Stream/session metadata and transcript `rawJson` already provide versionable storage without requiring a production database migration.

The implemented data flow is:

1. Transcription preserves word timing, ASR confidence, provider-local speaker labels, and provider speaker confidence.
2. `SpeakerContextService` namespaces local labels by provider window and resolves them into source-level IDs. Stored aliases are reused exactly; adjacent-window continuity is conservative; optional source-scoped acoustic embeddings can reconcile returning voices across distant windows.
3. The canonical context stores identities, absolute source intervals, overlap, uncertainty, colors, face mappings, corrections, model versions, and attribution metrics in session metadata. Stable word assignments are cached in transcript `rawJson`.
4. OpenAI final caption refinement aligns its improved words back to the canonical speaker timeline instead of deleting speaker attribution.
5. Caption grouping splits only at sufficiently confident speaker boundaries. Preview and ASS burn-in use the same speaker color. Multi-cut rendering remaps timestamps while retaining the source-level ID.
6. Face matching aggregates repeated audio/visual synchronization and rejects overlap, one-frame guesses, and weak dominance. Professional reframing consumes a confident saved mapping. Unknown and off-screen speech holds the current composition.
7. Clip Studio exposes source-persistent names, colors, visibility, merge, split, and caption-range reassignment controls. Corrections are stored as typed feedback events.

## Providers and deployment policy

Deepgram is the current default diarization source when its key is configured because it is already in the transcription pipeline, returns word timestamps with speaker labels, works without a Railway GPU, and does not add a second full audio pass. `TRANSCRIPTION_LIVE_PROVIDER` and `TRANSCRIPTION_VOD_PROVIDER` can select Deepgram or Whisper independently. Whisper remains a text and timing refinement path; refined words are speaker-aligned afterward.

The September 2026 provider review uses primary documentation:

- [Deepgram diarization](https://developers.deepgram.com/docs/diarization) exposes word-level speaker labels and pre-recorded speaker confidence. Clipper requests `diarize_model=latest` by default, which currently selects the v2 batch diarizer, while retaining an explicit version pin and opt-out. Deepgram recommends testing representative audio before changing production traffic.
- [pyannote Community-1](https://huggingface.co/pyannote/speaker-diarization-community-1) is an offline 16 kHz mono pipeline under CC-BY-4.0 with speaker counting, assignment, exclusive diarization, offline use, and an optional hosted path. Its gated model download, Python/Torch memory footprint, and whole-file workflow make it a candidate for a separate final-quality worker rather than the Railway web process.
- [NVIDIA streaming Sortformer](https://docs.nvidia.com/nemo-framework/user-guide/26.02/nemotoolkit/asr/speaker_diarization/models.html) keeps an arrival-order speaker cache across chunks, which directly addresses live identity continuity. The published streaming configuration is capped at four speakers and NVIDIA's reference voice-agent configuration uses CUDA, so it needs a GPU worker and separate evaluation for podcasts with more participants.

These capabilities make Deepgram the deployable default today, pyannote a final-pass candidate, and Sortformer a live GPU-worker candidate. This is an architecture and deployment decision, not an accuracy ranking: Clipper does not yet have the consented reference set needed for a valid head-to-head DER/JER benchmark.

`SpeakerDiarizationProvider` and `SpeakerEmbeddingProvider` define replaceable boundaries for a hosted provider or isolated GPU worker. A pyannote or NeMo deployment should live behind those boundaries. Neither model is bundled into the Railway web process: model startup, memory use, GPU availability, commercial terms, and representative-recording accuracy must be measured before making one a production dependency.

The resolver never treats `speaker_0` in two independent windows as the same person. Without a confident alias seam or an acoustic embedding, it creates a separate uncertain identity. This favors explicit uncertainty over a polished but incorrect assignment. Acoustic vectors, when configured, remain scoped to the source session and are not a cross-stream biometric database.

Audio-stream inspection records stream count, channels, layouts, labels, and conservative likely roles. Stereo is never interpreted as two people. Multiple streams are only marked meaningfully separate when labels support at least two distinct source roles; the current renderer and transcript extractor continue using the source mix until source-specific extraction has been validated on real captures.

## Versioned policies

- Canonical context: `speaker-context-v1`
- Identity resolution: `speaker-identity-v1`
- Caption palette: `clipper-speakers-v1`
- Audio/visual camera decisions: `audio-visual-speaker-v2`
- Audio/visual face matcher: `audio-visual-speaker-matcher-v1`
- Audio source profile: `audio-sources-v1`

The caption palette uses warm ivory, muted green, gold, lavender, blue, coral, periwinkle, and rose with the existing outline/background treatment. A display name can change without changing the source identity or color. Color is an additional cue; the renderer also supports speaker labels for policies that enable them.

## Performance and quality measurement

The web process reuses persisted transcripts, words, face tracks, and session metadata. Speaker context is content-hashed and skipped on a cache hit. Final rendering refreshes context after caption refinement, while live clipping does not block on a heavyweight model. The stored metrics include total, attributed, and unresolved words plus overlapping-speech duration.

When Deepgram is the VOD provider, default transcription windows expand to 180 seconds. This reduces provider-ID resets and request count while live windows stay short for responsiveness. Source-level resolution still namespaces every processing window and requires a seam or acoustic evidence before identities are joined.

Automated coverage includes returning speakers with changed provider-local IDs, refusal to equate distant local IDs without acoustic evidence, overlap and ambiguous-boundary handling, creator override precedence, stable colors, multi-cut remapping, colored ASS output, repeated-evidence face matching, overlap rejection, and off-screen camera hold. These tests validate invariants; they are not DER/JER claims.

A production accuracy benchmark still requires consented representative recordings and reference annotations. Report DER, JER, word-speaker accuracy, identity switches, face-match accuracy, correction frequency, caption timing error, processing time per audio hour, peak memory, provider cost, and final-render latency by content class. Include separate scoring for short punchlines, interruptions, code-switching, game dialogue, off-screen speech, and selected-clip first/last words. Do not promote a new diarization or embedding provider based only on aggregate DER.
