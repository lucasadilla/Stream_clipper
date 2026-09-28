# Hook Intelligence and Story Packaging

Clipper now treats moment quality and short-form hookability as separate
decisions. The Hook Engine is an additive layer over the existing Moment,
Narrative, Visual Context, caption, render, and publishing systems.

## Pipeline

1. Existing local transcript, chat, audio, and visual signals produce candidate
   windows.
2. Narrative reconstruction establishes the grounded story and payoff.
3. The Hook Engine creates natural, context-compressed, quote-first,
   action-first, reaction-first, and carefully bounded payoff-tease openings
   when the source supports them.
4. Each candidate receives explicit first-frame, 0.5-second, one-second, and
   three-second metrics. The values are comparative quality dimensions, not
   virality probabilities.
5. A bounded critic rejects confusion, missing context, misleading promises,
   excessive spoilers, and incomplete stories. It can make one repair by
   selecting a safer candidate.
6. A strong configured model compares only the serious candidate subset. Its
   candidate IDs, title evidence, and source references are validated by
   application code before use.
7. Platform packaging generates several alternatives, validates source
   evidence, ranks specificity and accuracy above hype, and stores the final
   choice with its alternatives as PackagingDNA.

## Safe rollout

`HOOK_ENGINE_MODE` controls behavior:

- `legacy`: skip Hook Engine records.
- `shadow`: calculate and store HookDNA while preserving current production
  boundaries and titles. This is the default.
- `new`: apply a selected grounded contiguous opening and selected title.
- `ab`: apply the new decision to a stable configured percentage of moments.

Payoff teases and other nonlinear plans are recorded for comparison but remain
disabled in rendering. `HOOK_ENABLE_TEMPORAL_REORDERING` exists as an explicit
future gate; enabling the flag alone does not bypass renderer validation.

The old clip decision remains in `ClipSuggestion.rawAiJson` beside
`hookPackage` and `hookDNA`, so shadow comparisons and rollback do not require a
database migration. Platform alternatives and `packagingDNA` are stored in the
existing `PlatformExport.exportSettings` JSON.

## Model policy and cost

`lib/aiModelPolicy.ts` owns the new engine's provider/model routes, temperature,
token budget, timeout, fallback model, reasoning level, candidate budget, and
cost ceiling. The application continues to use the configured OpenAI-compatible
provider client. The Hook Engine performs one bounded comparison call for the
configured serious candidate subset, rather than analyzing every second of a
stream.

Every strong-model decision records provider, model, latency, token counts, and
estimated cost when token rates are configured. Visual Context events and the
existing transcript/narrative records are reused rather than recomputed.

## Stored evidence

`HookDNA` stores the source moment, hook type, first visual and caption timing,
opening transcript, setup/payoff/reaction timing, early cut count, reordering
decision, selected title strategy, cover frame, model versions, policy version,
and creator overrides.

`PackagingDNA` stores the platform, strategy, final package, ranked alternatives,
warnings, evidence, model version, policy version, and creator overrides.

Performance snapshots deliberately use nullable fields because each platform
exposes different metrics. Normalized labels compare retention against
available creator, platform, and category baselines; raw views alone are not a
hook-quality label.

## Benchmark protocol

Before changing the default from shadow mode, build a reviewed dataset across
gaming, podcasts, IRL, reactions, education, coding, interviews, science, and
commentary. Each item should identify strong and weak openings, necessary
context, payoff, reaction, preferred title, and generic or misleading titles.

Compare legacy and Hook Engine outputs blind on:

- human preferred opening and title
- context completeness and factual accuracy
- first-frame strength and confusion rate
- spoiler and misleading-hook rate
- metadata specificity
- latency, token use, and cost per selected clip

After publishing integrations expose metrics, evaluate one-, three-, and
five-second retention and viewed-versus-swiped behavior relative to appropriate
baselines. Require repeated observations before promoting an experiment.

