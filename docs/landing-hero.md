# Hero Shorts and connected-account views

The existing landing-page design is preserved. Three real public Shorts from `@StreamClipperAdmin` occupy the existing right-hand hero column. The heading, copy, fonts, particles, navigation, and following sections retain their original structure. There is no separate showcase, illustration, category filter, or creator submission workflow.

The curated videos are in `lib/heroShorts.ts`. Their public Shorts links and original portrait thumbnails were checked directly on the channel. Images load first; selecting a clip mounts its YouTube privacy-enhanced player. Only one player is mounted at a time. Closing it or pressing Escape restores the poster. No video downloads, re-encoding, or AI calls are involved.

The hero displays one small counter: **Views produced with Stream Clipper: [total]**, followed by **Updated daily**. As requested, its scope is the total views of **connected accounts**, including content posted outside Clipper. It is not a claim that every counted video was created in Clipper. The tooltip identifies that scope and last refresh; unknown counts are not fabricated.

## Daily collector

The independent worker timer sweeps once per UTC day. A durable lease, heartbeat, account cursor, and per-account pagination resume after restarts. Provider account IDs are deduplicated across Clipper users. Only active connections contribute to the next completed snapshot. The previous total remains visible throughout a refresh or temporary provider outage.

YouTube uses the channel's lifetime `statistics.viewCount` in one request. TikTok sums all public videos through `video.list`. Instagram walks media and reads `views` insights. Facebook walks Page videos and reads lifetime video views. X walks the owned post timeline, deduplicates media, and uses video views; it refuses to present a truncated timeline as a lifetime total. All pagination is built against fixed provider hosts; provider `next` URLs are not fetched.

Non-YouTube providers need analytics permissions already granted by the account owner, and platform access/billing where required. A missing permission, incomplete history, or unavailable metric retains that account's last complete count rather than replacing it with a partial sum or zero. Accounts without a complete available count are excluded. No new OAuth scopes are silently requested. Views from different platforms are not unique viewers.

Public requests read stored aggregate values only. They never query providers, reveal tokens/account identities, or trigger AI. Counter metadata and video playback stay separate. Additive Prisma tables: `PublicAccountMetric`, `PublicImpactSnapshot`; production's existing startup applies them with `prisma db push`.
