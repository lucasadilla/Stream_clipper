# Social publishing setup

Clipper supports account connections and server-side video publishing for YouTube, TikTok, Instagram professional accounts, Facebook Pages, and X. Each destination has its own job and result. Public publishing additionally depends on each provider's app access and account permissions; a readiness environment flag does not grant those permissions.

## Production configuration

Set `NEXT_PUBLIC_SITE_URL=https://streamclipper.stream`. Keep `AUTH_SECRET` stable: existing social account tokens and upload checkpoints are encrypted using `SOCIAL_TOKEN_ENCRYPTION_KEY`, or a key derived from `AUTH_SECRET`. Do not introduce a different encryption key without migrating existing encrypted values.

| Platform | Server variables | Authorized callback |
| --- | --- | --- |
| YouTube | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | `https://streamclipper.stream/api/social/oauth/youtube/callback` |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `https://streamclipper.stream/api/social/oauth/tiktok/callback` |
| Instagram | `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET` (Instagram app credentials) | `https://streamclipper.stream/api/social/oauth/instagram/callback` |
| Facebook | Same Meta app | `https://streamclipper.stream/api/social/oauth/facebook/callback` |
| X | `X_CLIENT_ID`, `X_CLIENT_SECRET` | `https://streamclipper.stream/api/social/oauth/x/callback` |

Each callback can be overridden by its corresponding `*_REDIRECT_URI`. Local development needs its own exact callback at `http://localhost:3000` or `:3001`, with `NEXT_PUBLIC_SITE_URL` pointing to that origin. Meta requires HTTPS; use a development HTTPS domain when testing its login flow.

The existing Google web client can also be used for YouTube publishing without rotating its sign-in secret. Railway variable references keep those values synchronized:

```text
YOUTUBE_CLIENT_ID=${{AUTH_GOOGLE_ID}}
YOUTUBE_CLIENT_SECRET=${{AUTH_GOOGLE_SECRET}}
```

Do not place client secrets, cookies, refresh tokens, or signed upload URLs in client bundles, screenshots, documentation, or logs.

## Provider setup

**YouTube.** Enable YouTube Data API v3 in Google Cloud, add the callback above, and configure the consent screen for `youtube.upload` and `youtube.readonly`. Users connect a channel from Settings → Connected accounts. The default capability is `private_test_only`; set `YOUTUBE_PUBLISH_CAPABILITY=production_ready` only after the relevant compliance audit/access is actually approved. OAuth verification and YouTube's API upload audit are separate requirements. See [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) and [resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol).

**TikTok.** Configure Login Kit and Content Posting API with `user.info.basic`, `video.publish`, and `video.upload`. Register the callback and verify ownership of the production URL prefix `https://streamclipper.stream/api/social/media-grants/` for server-hosted `PULL_FROM_URL` transfers. Complete TikTok's review/audit for public posts; until then only private viewing is supported. The review page queries fresh creator settings, displays the selected creator, requires an explicit visibility choice, defaults interactions off, and obtains per-post consent before transferring video. Autopilot prepares TikTok drafts for review rather than silently uploading them. Inbox mode requires the user to finish posting inside TikTok; it is not reported as a published post. See [Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines).

**Meta.** Use a publishing app with the Pages and Instagram use cases and Facebook Login for Business. Add both production callbacks with HTTPS and strict redirect matching. Supply the real privacy policy and terms URLs (`/privacy`, `/terms`) and complete Meta's required business/access verification and App Review before opening connections to other businesses. Clipper requests `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`. If the login configuration requires a configuration ID, set `META_LOGIN_CONFIG_ID`; the authorization request then uses that configuration instead of an explicit scope list. `META_GRAPH_API_VERSION` can select a supported Graph API version (default `v21.0`). Instagram direct login uses the separate Instagram app ID and secret from **API setup with Instagram login**, stored as `INSTAGRAM_CLIENT_ID` and `INSTAGRAM_CLIENT_SECRET`. Configure its exact Instagram callback, add your development account as an Instagram Tester, and request only `instagram_business_basic` and `instagram_business_content_publish`. A Business or Creator account can connect without a Facebook Page. If direct credentials are absent, Clipper retains Facebook Login for professional accounts linked to Pages; existing connections keep their saved API route even after direct login is enabled. Direct tokens are exchanged server-side for 60-day tokens and renewed during use within seven days of expiry. Accounts unused beyond token expiry must reconnect. See [Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login). Facebook targets Pages, not personal profiles. Neither platform has a pretend “private test upload” setting: development access restricts which users/accounts may use the app. See [Instagram publishing](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing/) and [Meta's Facebook Reels API collection](https://www.postman.com/meta/facebook/collection/r56bjfd/facebook-api).

**X.** Configure a confidential Web App / Automated App with the callback above and the website, terms, and privacy URLs. Use OAuth 2.0 with `tweet.read`, `tweet.write`, `users.read`, `media.write`, and `offline.access`; OAuth 1.0 consumer keys and app-only bearer tokens are not substitutes. The developer project needs publishing API access and available API credit. Clipper never purchases credits or enables auto-recharge. See [X media uploads](https://docs.x.com/x-api/media/initialize-media-upload).

**Snapchat (optional, not enabled).** Snapchat publishing requires eligible Public Profiles and access to the Public Profile API. A normal personal Snapchat login is insufficient. Obtain the required developer/partner access before adding an account connection or promising unattended posting. See [Snap Public Profile API](https://developers.snap.com/marketing-api/Public-Profile-API/Introduction).

## Delivery behavior and verification

Meta's Basic settings can use `https://streamclipper.stream/data-deletion` as the user data deletion instructions URL after that page is deployed. This page explains disconnection and the existing email deletion-request process; it is not an automated Meta signed-request callback. Do not enter it in the separate data deletion callback field.

Facebook Page discovery follows all response cursors, including empty intermediate pages, and fails rather than saving an incomplete list when paging breaks. Credentials stay in the Authorization header and paging never follows a response-provided host. Token-extension failures retain the original token's expiry; successful extensions use their own expiry.

- Studio's platform Post action binds the selected account and exact export ID, preserving that variant's framing and burned-caption choice. TikTok opens per-post review. Other supported platforms queue the job and open its existing tracking group.
- The publishing page restores its group from `?groupId=...`. Edits are saved in order; publish is disabled while saves are pending. Its video player serves the exact file attached to the job.
- Autopilot creates a deterministic publish group per automated clip, generates copy once per platform/format, prepares separate landscape/feed exports when needed, queues supported destinations, and leaves TikTok for review. The Autopilot settings page links to clips awaiting review.
- The worker persists encrypted upload checkpoints, reuses provider identifiers after restarts, polls remote processing without consuming additional upload attempts, and only reports Published after confirmation. A lost response to a non-idempotent final post is marked for account review, not blindly retried.
- Short-lived signed media URLs support GET, HEAD, and byte ranges. Draft previews require the owning user's session. OAuth state is consumed atomically and bound to the initiating user, and callback destinations remain local to Clipper.
- Tests use mocked provider contracts and real temporary-file byte transfers. They do not publish to real accounts. Finish live verification with one explicitly approved private/test clip per supported destination after credentials, account grants, and platform access are ready.

Run `npx vitest run`, `npx tsc --noEmit`, and `npm run build` before deploying. No social database migration is required by these changes.
