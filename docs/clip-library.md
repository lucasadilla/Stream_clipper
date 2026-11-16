# My Clips

`/library` is a private library of completed, full-quality renders and platform exports. It uses the existing black/green visual system and account menu. It provides title/source search; platform, connected-account, posting-status and date filters; a version picker; native streaming downloads; editable titles and posting captions; posting history; and links to the existing review/scheduling/retry workflow.

## Preservation and retention

- Final videos are copied byte-for-byte into `STORAGE_ROOT/library/<account>/<clip>/<asset>.mp4`. There is no re-encoding, source download, or AI call. Previews are excluded. Each finished render/export has a deterministic asset identity; caption flags describe captions actually burned into the video, not optional subtitle sidecars.
- Copies use a temporary file, fsync, and atomic rename before being marked ready. ffprobe verifies the saved video; a local thumbnail failure does not discard the MP4.
- Render/export completion attempts preservation immediately. Worker maintenance retries pending copies in batches of five and imports older completed files still present on disk. Failed copies rotate behind other work. Files already removed before this feature cannot be recovered; missing versions are labeled unavailable.
- Every workspace deletion/replacement/retention path first preserves its completed exports and defers while an encode or save is in flight. Source files can then expire normally. Referenced session/clip/render/export records remain for publishing and posting history; expired sessions are hidden from the active workspace.
- Durable MP4 bytes count toward existing account storage usage. This feature adds no new quotas or spending controls. The library needs the same persistent storage volume and backups as the rest of Clipper; filesystem loss is not protected by a database record alone.
- Stored versions remain downloadable after a subscription ends. Posting still requires the existing active-plan entitlement. New crops, caption burns, or layouts require an available original source in the active studio.

## Posting

The library links into the existing publisher with `library=1`. It reuses an exact saved platform variant, or an appropriate general vertical/landscape render. Instagram feed requires its own saved variant. A requested format that was never saved produces an actionable error rather than downloading the source or silently generating another format. Posting captions edited in My Clips seed new drafts; existing published posts and burned-in captions are unchanged. Existing provider permissions, review, TikTok consent, idempotency, scheduling and retry rules still apply.

## Access and deletion

- List, details, thumbnails, streaming, Range/HEAD downloads, edits, and Trash actions enforce the signed-in billing-account owner. DTOs expose no filesystem paths or access tokens. File requests validate the real path under that exact owner's clip directory and use `private, no-store` responses.
- Saved clips redirect from the old public clip page into the private library; their metadata is not indexed. Existing signed media grants used by social publishers retain their current authorization checks.
- Metadata/deletion mutations require same-origin JSON requests. Unknown editable fields are rejected.
- Trash is recoverable for 30 days. Restore returns every saved version. Permanent deletion removes only the validated clip directory and clears its asset paths/byte totals. Tombstones prevent maintenance from resurrecting deleted clips.
- Scheduled, active and uncertain posting jobs block deletion. Per-clip database leases serialize saving, enqueue/retry, Trash and purge transitions. Already published posts remain on their platforms.

## Deployment

The additive Prisma schema adds `ClipLibraryItem`, `ClipLibraryAsset`, render/export `libraryState`, and an optional publish-group library relation. Use the existing production startup `prisma db push --skip-generate` flow and deploy the matching generated client with the code. Ensure `STORAGE_ROOT` points to persistent storage and `WORKER_ENABLED=1` on a worker. No new provider credentials or paid API configuration are required.

## Verification

Standard checks: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npx prisma validate`, and `npm run build`.

The opt-in PostgreSQL/file integration suite runs only when `CLIP_LIBRARY_TEST_DATABASE_URL=postgresql://cliptest@127.0.0.1:55439/clip_library_qa`. Prepare that disposable database from the schema and install ffmpeg/ffprobe. On machines without pgvector, the unrelated unsupported vector fields can be replaced with unsupported text in a temporary test schema; production schema is unchanged. Tests generate their own synthetic MP4, use isolated temporary storage, and clean up their own rows/files. They cover workspace replacement, retention, byte identity, private Range/HEAD requests, owner isolation, saved platform/caption variants, archived posting media, active render deferral, Trash/restore/purge, scheduled-post protection, manual renders, preview exclusion, expired subscriptions, and safe metadata edits.
