# Clip experience: preview, first results and recovery

## Finished video previews

Studio keeps the instant editing preview for quick adjustments. Prepare finished preview encodes the selected platform variant and replaces the approximation with a normal video player serving that exact export. Captions and framing are already burned in, so the browser adds neither a second crop nor duplicate captions. Download and Post reuse its export ID. General downloads remain 9:16 and have their own finished-file player.

Studio pins the exact master render ID when creating platform exports. The server checks that it is a completed general render belonging to the authorized clip/session and that its trim still matches. A newer render from another tab cannot replace it. Semantic settings identities invalidate finished-file URLs when trims, captions, style or framing actually change; refreshing identical caption objects does not. Requests also check the expected trim before rendering.

Equivalent platform-pack requests use a stable request hash and a short PostgreSQL advisory transaction lock. After a lost POST response, a repeated request reuses the pack instead of creating another encode or repeating copy generation. Failed destinations and missing files are prepared again; completed destinations in a partially failed pack retain their finished files. Studio supplies existing copy and requests no new copy generation for finished previews.

## Earlier usable results

Existing moments stay visible and can be opened during later suggestion generation or partial transcription. A read-only poll observes committed clip rows during discovery; it does not trigger more AI calls. Discovery still writes complete, validated titles and descriptions.

The first ranked clip warms its lightweight Studio playback in the background. Playback validates its own cached file before asking for source media, avoiding repeat source acquisition for already usable previews. Cache checks require a decodable video covering the entire requested range. Warming only one clip avoids an unbounded parallel download/encode burst.

## Recovery and stages

Browser recovery stores opaque render/pack IDs, request hashes and timestamps for up to 24 hours. It stores no caption text, tokens or file paths. Reopening the same render request resumes polling that job; changed trims or settings do not attach to old work. Server authorization still controls every read and download. If browser storage is unavailable, normal rendering still works.

Polling has individual request timeouts, bounded reconnect/backoff, cancellation cleanup and clear terminal failure handling. A disconnected browser does not cancel the server job. Retrying a matching render can reuse an identical completed file on disk. Source-download, transcription and suggestion errors each get the correct retry action, preserving existing clips and edits. The UI names actual stages instead of cycling through invented scoring or almost-done messages.

Abandoned render recovery uses a compare-and-swap on the processing status and stale heartbeat. A worker that renewed its lease after the query is not requeued. Retries remain bounded by the existing attempt limit. No spending controls or additional AI scoring are introduced.

## Verification

Regression tests cover same-job recovery, network reconnects, aborted waits, changed trims/caption settings, exact master pinning, matching pack reuse, lease races, completed-file reuse, cached preview coverage and availability of existing clip cards during background work. Local browser fixtures verify source retry, opening a clip while discovery runs and replacing a platform approximation with its exact finished file. Fixtures contact no AI or publishing providers.
