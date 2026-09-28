# Gameplay-aware layout engine

## Audit and baseline

Clipper already had a strong subject-framing pipeline before this engine was added:

- `workers/facecam/analyze.py` uses YuNet/OpenCV with MediaPipe landmarks, recovery passes for missed small faces, scene detection, and audio/visual speaking evidence.
- `lib/professionalReframe.ts` owns face-camera trajectories, identity continuity, headroom, dead zones, speed limits, scene resets, and active-speaker changes.
- `lib/verticalLayoutFilters.ts` renders stacked, PiP, center, and subject-aware compositions through FFmpeg.
- `lib/visualAnalysis.ts` and `services/visualContextService.ts` provide cached local visual events plus selective multimodal context for candidate moments.
- `services/renderService.ts` provides the final-quality render path and platform dimensions. `services/postRenderCriticService.ts` samples the completed output.
- Clip Studio already persisted creator layout choices and manual camera keyframes.

The principal failure was in the gameplay branch: stacked and PiP layouts used a static center or opposite-webcam crop. Face framing could be professional while the event that made the clip valuable moved outside the gameplay window. Layout choice also did not validate simultaneous important regions, share exclusions with captions, or execute reaction changes stored in a whole-clip plan.

The baseline behavior is covered by the pre-existing vertical-filter and face/reframe tests. The representative regression matrix in `tests/gameplayLayoutBenchmark.test.ts` adds FPS, racing, strategy, webcam-free, small-webcam, edge-HUD, and low-resolution cases. These are deterministic geometry fixtures; authorized production clips should be added as private benchmark fixtures without committing creator media.

## Processing stages

1. The face worker decodes each selected clip once. The existing face pass also samples a 160x90 grayscale gameplay view at `GAMEPLAY_ANALYSIS_FPS` (2 FPS by default).
2. A 4x3 spatial pass scores motion, edge/detail density, contrast, restrained center saliency, and edge/HUD changes. It emits at most three normalized regions per sample and marks real scene cuts.
3. `buildGameplayImportanceMap` combines local regions with cached `VisualEvent` evidence. Timestamped multimodal `importanceRegions` can add visible action, outcome, target, and relevant-HUD evidence. Regions overlapping the detected webcam are discounted.
4. The map merges temporally adjacent evidence and records normalized coordinates, source timestamps, category, strength, confidence, and provenance. Missing or low-confidence evidence forces a full-context fallback.
5. The candidate generator evaluates three stacked ratios, four PiP positions, dynamic reaction emphasis, gameplay-only framing, and conservative full context.
6. Every candidate passes mandatory checks for gameplay coverage, simultaneous-region coverage, webcam/source quality, caption safety, and temporal stability. A hard gameplay or webcam failure removes the candidate.
7. The versioned ranker chooses the strongest valid candidate. PiP occlusion is measured against important regions. Caption placement compares stable top and bottom bands against gameplay and webcam exclusions.
8. The gameplay camera groups simultaneous evidence, fits the combined region where possible, limits pan speed, ignores small movement, eases continuous motion, and cuts only at detected scene changes. It emits at most 40 keyframes.
9. Sustained face/audio reactions may create a small number of PiP-to-stacked intervals. FFmpeg renders both validated branches from the same source and enables the stacked branch only during those intervals. Clip Studio previews the same plan.
10. Final renders reuse the cached importance map and face tracks. Candidate geometry is reranked cheaply for the actual output dimensions, so platform variants do not repeat CV or multimodal analysis.

## Creator authority

An explicit layout remains authoritative. Automatic analysis may still supply a gameplay camera within the creator's chosen stacked, PiP, or gameplay-only composition, but it does not replace the chosen family, split, PiP position, webcam selection, or manual crop keyframes. Manual camera keyframes are merged over automatic gameplay keyframes for both preview and render. The Auto Look control can disable reaction emphasis without disabling gameplay tracking.

## Quality validation

Pre-render validation records hard failures and warnings on every candidate. The finished-output critic adds samples at important gameplay timestamps and checks action, outcome, target/HUD visibility, PiP obstruction, geometry, sharpness, empty areas, and composition balance. Existing retry limits remain in force; uncertain analysis selects the conservative full-context layout rather than creating an aggressive crop.

## Cost and telemetry

The stored face-analysis result records local-CV time, layout-planning time, total analysis time, sampled-frame count, signal/region/candidate counts, and the fact that the analysis is reusable for platform planning. `layoutDna` records source geometry, webcam region, visible tracks, important regions, alternatives, selected split/PiP geometry, gameplay trajectory, caption safe zone, dynamic changes, versions, and creator corrections.

No general-purpose object detector is bundled. Game-specific detectors remain a provider extension point because one model cannot reliably identify every game's targets, vehicles, objectives, and UI, and adding model weights requires a separate licensing and deployment review. When structured object or OCR evidence is absent, the engine combines local CV and selective multimodal evidence and chooses wider framing when confidence is low.

## Verification

- Pure planning and benchmark tests validate region merging, webcam exclusion, multiple simultaneous regions, candidate validity, PiP placement, fallbacks, reaction restraint, and bounded keyframes.
- Filter tests validate eased/cut-aware gameplay motion and the dynamic reaction graph.
- A gated FFmpeg integration test (`RUN_FFMPEG_LAYOUT_VERIFY=1`) executes the generated dynamic filter graph on synthetic video.
- TypeScript, ESLint, Python compilation, and the full Vitest suite are required before release.
