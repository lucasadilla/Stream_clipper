# Landing page proof and showcase

The landing page displays verified views on **posts published through Clipper**, not unrelated account/channel totals or impressions. Missing analytics stay unavailable, distinct from zero. These are platform-reported views, not unique viewers.

## Daily counter

`startPublicImpactPoller` starts alongside the existing background worker. A database lease and persisted cursor discover completed publish jobs, deduplicate `(platform, platformPostId)`, and refresh four posts per batch, two concurrently. The loop does not await or block render work. It resumes after restarts and runs once per UTC calendar day. At midnight the previous public snapshot remains visible until the next sweep finishes. The public page/API read stored snapshots only; visits do not trigger social API or AI calls.

YouTube uses basic video statistics (no watch-time request). TikTok needs `video.list`; Instagram needs insights access. X provides media views, which can include other posts using the same media. Facebook currently has no video-insights integration and is excluded rather than substituting engagement or impressions. Failures preserve each post's last known count and retry next day. Provider corrections can lower the total. Reposting the same provider post ID never adds it twice; posts on different platforms count independently. No new scopes are granted by this feature.

PublicPostMetric records survive source-session cleanup. Account deletion cascades their removal; disconnecting stops refresh but preserves already recorded historical views. The public payload contains totals/coverage/time only, no connected account IDs, tokens, or private post metadata. The counter stays absent until at least one platform returns a valid count. A real zero is displayed as zero.

## Opt-in showcase

Creators visit `/settings/showcase`, choose an owned completed vertical platform export, enter a public title/credit/category, and explicitly authorize displaying that clip and its source excerpt. Submission makes a dedicated copy under `storage/showcase/<opaque-id>/`. It reuses an already-cached widescreen Studio excerpt when available, never downloads or renders another source. Shorts are limited to two minutes and 200 MB, source excerpts to 100 MB; twelve active submissions per creator.

Configure **`SHOWCASE_ADMIN_USER_IDS`** to a comma-separated list of authorized Clipper user IDs. Those users see **Review showcase** in the same settings page. The owner must watch the finished clip and approve it. At most twelve approved clips are featured. The landing page leads with gaming, podcast, and IRL examples, using recorded views to choose the strongest in each category. Clips from the same original recording are grouped in the widescreen-to-shorts demonstration. Missing source media is labeled as a layout demonstration, never passed off as real video. No arbitrary famous/third-party clips are seeded or implied to be Clipper customers.

Pending/rejected/withdrawn media is available only to the submitting user and configured reviewers. Public media routes recheck approval and consent on **every request**, use no shared caching, and support byte ranges/HEAD through the existing video response helper. Withdrawal stops new public requests immediately; already delivered bytes cannot be recalled. Source cleanup does not touch the showcase bucket. User deletion removes database access to their showcase copies. A storage lifecycle policy can remove unreferenced showcase copies later.

The existing per-clip marketing permission endpoint also withdraws any copied showcase submission when permission is turned off. Restoring that older flag alone cannot approve or republish a submission.

## Release

Additive Prisma schema: `PublicPostMetric`, `PublicImpactSnapshot`, `ShowcaseClip` and inverse relations. Run `prisma generate` locally; the existing production startup runs `prisma db push`. Configure reviewer IDs before the first approval. Seed with opted-in real Clipper gaming, podcast, and IRL exports. Until then the page clearly labels its illustrated layout examples and never invents views or customers.
