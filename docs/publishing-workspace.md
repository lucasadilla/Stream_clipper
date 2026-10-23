# Publishing workspace

Settings → Publishing now contains a review inbox, a publishing calendar, and post performance. Settings → Channel presets saves a style for each connected account. The previous global publishing options remain under Publishing → Defaults.

## Review and schedule

Prepare a post from Studio or select publishing destinations in Autopilot. With automatic posting disabled, Autopilot creates review drafts after rendering. The inbox plays the exact file attached to each destination; it never silently replaces an approved export with another variant. Save title/description edits before selecting a post.

Select up to 30 ready destinations and approve them now or at a future local time. Only selected jobs are approved. Every destination revalidates its account, media and provider requirements, then uses an ownership/version/lease check to prevent stale approval or races with a worker. Partial failures are reported individually. TikTok still requires individual video/caption consent and its existing visibility and music confirmations. Provider test/private restrictions still apply.

The calendar shows scheduled, queued and confirmed published posts. Drag a scheduled card to a day, or use Change time for an exact date/time. Phones use an agenda. Move, return-to-review and cancellation actions only affect jobs that have not started; drafts need approval before scheduling. Times are stored as UTC instants and displayed in the browser's local timezone.

Pause publishing & Autopilot stops new worker claims and checks pause again before uploading. Uploads already in flight may finish. Resuming publishing does not re-enable Autopilot; enable it explicitly in its settings. A dedicated deterministic preference row holds the pause flag, so saving an older defaults form cannot accidentally resume delivery.

## Channel presets

Each active connected account can save caption visibility/style, content layout look, a corner brand label/color, posting format/privacy defaults, hashtags and a caption footer. Apply a saved style explicitly in Studio and render again. Styling choices do not mutate existing rendered clips or scheduled posts.

Autopilot prepares a separate export for each saved account style, pins the account and a style hash, and waits for that exact export. A neutral master avoids one destination's branding leaking into another account's output. Unstyled destinations exclude channel-specific variants. The brand label is burned into the actual video using a UTF-8 text file with FFmpeg expression expansion disabled. Native landscape remains landscape and branding forces encoding rather than being dropped by stream copy.

Manual post preparation can use saved posting defaults. Applying visual styling still requires the explicit Studio render step. TikTok visibility/music choices and individual post consent cannot be pre-approved by a preset.

## Performance

Performance displays statistics only for the signed-in owner's confirmed published jobs. Refresh is manual, bounded to 20 jobs/request, concurrency four, with a one-hour per-post cache and a database lease to avoid duplicate requests. A renewed connection allows immediate retry of a cached permission error. No AI scoring or extra generation is used. Up to 24 recent events per post are read for a 30-day view-count trend. Missing metrics remain unavailable (—); a failed refresh preserves the last successful snapshot.

- YouTube: views, likes and comments through Data API v3. Optional average watch time, percentage viewed and shares through YouTube Analytics. Enable YouTube Analytics API and authorize `yt-analytics.readonly` alongside the existing `youtube.readonly`. The Performance tab offers opt-in reconnect; standard account connection scopes do not change.
- TikTok: views, likes, comments and shares with optional `video.list` access. Configure/approve that scope in the developer app, then use the opt-in reconnect link. Private/inbox videos may not be queryable. Retention is unavailable through this endpoint.
- X: actual media video views are separate from post impressions. Completion uses available recent owned-video playback counts; older or inaccessible metrics remain unavailable. Media view counts can aggregate posts reusing that media. Existing API access/credits are still required.
- Instagram: likes/comments, plus views/shares/saves when the token has insights access. Missing insights permission retains available basic counts. No automatic scope expansion.
- Facebook: Page engagement counts. Video views and retention require additional Page insights access and are left unavailable here.

Platform definitions differ and statistics can be delayed. Compare similar posts from the same account. The UI reports data availability and permission issues rather than substituting zeroes or estimated performance.

References: [YouTube statistics](https://developers.google.com/youtube/v3/docs/videos/list), [YouTube Analytics queries](https://developers.google.com/youtube/analytics/reference/reports/query), [TikTok video query](https://developers.tiktok.com/doc/tiktok-api-v2-video-query/), [X metrics](https://docs.x.com/x-api/fundamentals/metrics).

## Storage and verification

The implementation reuses existing publishing jobs, events and preference JSON. It adds no Prisma migration, dependency or spending controls. Tokens stay server-side; responses expose no storage paths or raw provider payloads.

Run `npx vitest run`, `npx tsc --noEmit`, lint and `npm run build`. Regression coverage includes selective approval, stale versions, ownership, TikTok consent, scheduling/holding, pause races, account-specific exports, metrics caches, reconnects and missing data. A real FFmpeg test verifies visible branding in vertical, native and sequence output and preservation of native dimensions/audio. Browser QA uses a local fixture proxy with sample data and never contacts publishing providers.
