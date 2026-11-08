# Implementation plan: Arabic-first Islamic knowledge discovery platform

Status: approved by the project owner, 2026-11-04. The content below is the plan as approved, written at planning time; current progress is tracked in `docs/PROJECT_STATUS.md`.

## 1. Context

`docs/MASTER_SPECIFICATION.md` (all 2,224 lines read) defines a free, Arabic-only, RTL product for ages 16–30. It connects a vertical Shorts feed, a topic-centred knowledge network, articles, libraries, playlists, and a volunteer admin dashboard with a YouTube channel importer.

**Repository audit:** the repo is greenfield. It contains only the spec (untracked) and has no commits, `package.json`, Prisma schema, auth, or conventions to preserve. The branch is `master`, while the configured main branch `main` doesn't exist yet. Local runtime is Node 24.19 and npm 11.17.

**Bottom line:** the product can be built on the required stack, but four issues need your attention first:
1. **YouTube policy (needs your action):** a multi-channel feed of videos you don't own sits in an ambiguous area of YouTube's policies. Code can't settle this; a compliance audit can (R1).
2. **Feed design:** YouTube forbids anything in front of the player, so TikTok-style text overlays are not allowed (L1).
3. **Package versions:** the default `latest` installs of Prisma and TypeScript would break this stack (section 3).
4. **Auth version:** the spec's "no prerelease" rule conflicts with using Auth.js v5, which is still in beta (D1).

## 2. Decisions (recommendations approved with this plan)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Auth library | **`next-auth` 4.24.15 (stable)** behind a thin `lib/auth` wrapper | v5 is still `5.0.0-beta.32`, and the spec bars prerelease versions. v4 is stable, recently security-patched, and accepts Next 16 as a peer. Better Auth is outside the "Auth.js/NextAuth-compatible" requirement. The alternative is v5 beta, which is closer to the spec's `AUTH_*` variable names. |
| D2 | Feed layout (see L1) | Player on top, with title, channel, CTA and actions **outside** the player | This is the compliant layout. It is near-full-screen rather than edge-to-edge with overlays. |
| D3 | Video data model | One `Video` model with `kind: SHORT or LONG_FORM`, replacing the spec's `Short` model | §12.6 forbids an isolated video system, and playlists and topics need both kinds. It also makes duplicate prevention by video ID global. |
| D4 | Category cardinality | Each video or article has **one primary category** and many topics | This keeps scoring transparent. Multi-classification is handled by topics. |
| D5 | Additions not in the spec | Approve: `/privacy`, `/terms`, a one-time first-visit privacy notice, `/videos/[id]`, `/admin/resources`, `/admin/youtube-status`, `Collection`, `ReviewNote`, and "delete my account and data" | The first three are needed for YouTube compliance (R3). The next three give spec features a route. `Collection` backs §11.3/§16, and `ReviewNote` backs §19.4 feedback. Account deletion is my recommendation because interests in religious topics are sensitive data. |
| D6 | YouTube statistics | Build the feature, but **default it to off** until the audit confirms it is allowed | See R2. The spec already treats statistics as optional. |
| D7 | Hosting | Stay **provider-neutral** unless you have a target | The design works on a VPS or serverless. Tell me if you've already chosen, since local file storage won't persist on serverless. |
| D8 | Execution and git | Pause for your review **after Phase 1 only**, then continue automatically as §1.4 says. Create `main` and make one commit per passed phase. | Phase 1 validates the riskiest assumptions. I won't commit without this approval. |
| D9 | Topics and channels (owner's decision, 2026-11-07) | **Channels are assigned to topics, and a video's topics are its channel's.** Topics replace categories everywhere, and the `Category` model is gone, which replaces D4. First-visit choices fill the screen: pick topics, then a grid of channels with those topics' channels on and the rest off. They can be skipped, shared links bypass them, and they can be changed at `/interests` at any time. Switches affect the personal feed only. | Sorting videos one by one wasn't workable for the team. Differs from specification §9 (categories, and an optional prompt), §10 (categories), and §13.1 (Shorts ↔ Topics per item). Skipping stays, as §9.1 requires. |
| D10 | Content sources (owner's decision, 2026-11-07) | **Admins follow sources, and new content is published automatically.** One box on `/admin/sources` takes a channel, a playlist, or video links. A followed channel's uploads are fetched on the server and published as they arrive, classified as Short or long by duration and shape. Each channel is checked hourly by a protected endpoint (`/api/cron/sources-check`), called by a GitHub Actions schedule, and YouTube playlists are re-synced in the same run. Admins hide or show any video, change its kind, and stop following a channel from that channel's page. A hidden video stays hidden. A channel’s own playlists are added and published after its uploads, and re-read daily, including for channels added with the old importer (owner’s request, 2026-11-08). The checks stop at a configurable daily quota ceiling and can be switched off in the settings. The 12-step import workflow and its review queue are gone. | The importer took too long and needed two separate screens before anything was live. **Differs from specification §7.1 (preview and selection before import), §7.2 ("do not automatically publish uncertain candidates"), §7.4 (review before publication, and no background polling), and plan L5 (no auto-publish).** The cadence is configurable and quota-aware, as §7.4 asks of any schedule. |

## 3. Stack and compatibility findings

Versions were read from the npm registry on 2026-11-04. Exact pins go in `package.json`, and Phase 1 proves them with a clean install and all quality gates.

| Area | Choice | Risk found | Handling |
|---|---|---|---|
| **Prisma** | **Pin `prisma` and `@prisma/client` to exactly 6.19.3** | The npm `latest` tag for `prisma` is currently **`8.0.0-rc.30`**, a release candidate. Prisma's docs say v7 doesn't support MongoDB yet and recommend v6.19. | Never install unpinned. Keep queries in service modules so a future move is contained. The long-term path depends on Prisma, so recheck it before any major upgrade. |
| **MongoDB + Prisma** | MongoDB with a replica set | Transactions and nested writes **require a replica set**. There is no Prisma Migrate. `createMany` has no `skipDuplicates`. Null and missing fields behave differently in filters. | Use Atlas or a single-node replica set locally, `db push`, and an indexes script. Importer pre-checks existing IDs and handles unique-index conflicts. Use `isSet` where needed. |
| **Optional unique fields** | A required `sourceKey` on `Playlist` | MongoDB's unique index treats null or missing as one value, so a second curated playlist with no `youtubePlaylistId` would collide. | Use `yt:<id>` or `cur:<uuid>` as a required unique key. Apply the same pattern to any optional unique field. |
| **Text search** | MongoDB text index with `default_language: none` on normalised fields | MongoDB has **no Arabic text language**. Prisma's v6 full-text docs cover only PostgreSQL and MySQL. | Application-level Arabic normalisation, indexes from a script, and raw queries inside the search service (section 6). Phase 1 checks that `db push` leaves script-made indexes alone. |
| **Next.js** | 16.4.5, React 19.3.1 | `middleware` is deprecated in favour of `proxy.ts`. Reading the session in a shared layout would make public pages dynamic and hurt caching. | Keep public pages cacheable and load session state in small client islands. Enforce authorization in layouts **and** services, never only in the proxy. |
| **Arabic slugs** | Arabic slugs, as specified | Route params can arrive percent-encoded. | Decode and normalise in one helper, with tests for it and for canonical URLs. |
| **TypeScript** | **6.0.3** (fallback 5.9.3) | `latest` is 7.0.2, but `typescript-eslint` 8.72 requires `<6.1.0`, so TS 7 would break the lint gate. | Pin it. Phase 1 confirms Next and the Prisma client compile under it. |
| **Auth** | See D1, with database sessions | JWT sessions would keep role changes and deactivations stale until expiry. v4 uses `NEXTAUTH_URL`. | Sessions live in the database and roles are read on the server. Use `@next-auth/prisma-adapter`. `AUTH_SECRET` and `AUTH_GOOGLE_*` stay as named, and `NEXTAUTH_URL` is added (§26 allows this). Request only `openid email profile`, **no YouTube scopes**. |
| **UI** | Tailwind 4.3, shadcn 4.x, Lucide | The RTL details I found for shadcn came from third-party sources. | Verify against official docs in Phase 2. Use logical properties only, with a lint rule against `ml-`, `mr-`, `left-` and `right-`. Flip directional icons. |
| **Editor** | Tiptap 3.32 | Its peers accept React 19. Footnotes and captions need custom nodes. | Store Tiptap JSON only, render through an allow-list, then sanitise. Validate on the server. |
| **Tests** | Vitest 5, Playwright 1.64, Mongo replica set for integration | Real Google sign-in can't be automated reliably. | Mock YouTube at the HTTP layer. Seed a real `Session` record in E2E tests, so no test login provider ships. |

**Added dependencies beyond the spec's list:** `sharp` (image optimisation), `@aws-sdk/client-s3` (S3-compatible adapter, loaded only if configured), `sanitize-html`, and dnd-kit (playlist reordering, §15.2). There is no Redis, queue, external search, or i18n framework.

## 4. Spec limits and third-party restrictions

No product requirement is removed. These change how requirements are implemented.

### 4.1 Not possible as literally imagined

| # | Item | Compliant approach |
|---|---|---|
| L1 | **TikTok-style overlays on video.** YouTube states: "You must not display overlays, frames, or other visual elements in front of any part of a YouTube embedded player." | Title, CTA and actions sit beside the player on desktop and below it on mobile. Any glass layer for catching swipes is also prohibited. |
| L2 | **Swiping on the video.** The cross-origin iframe owns its touches, and policy forbids using touch events on the player to initiate actions. | Swipe from the panel and margins, plus next/previous buttons and keyboard. **Biggest UX risk: tested on real phones in Phase 1.** |
| L3 | **Autoplay with sound.** Browsers block it. | Start muted and unmute after a tap, with a real control outside the player that calls the documented `mute`/`unMute`. Handle `onAutoplayBlocked`. |
| L4 | **Custom play/pause UI on the video.** The player's own controls stay enabled. | Keyboard shortcuts and external actions use documented API methods only. No imitation controls. |
| L5 | **Certain Short detection.** Confirmed by the spec. YouTube says Shorts run up to 3 minutes and are square or vertical, but the API has no Short flag. | Configurable duration threshold (default 180s) creating *candidates*, with human review and no auto-publish. I'll test `player.embedWidth/Height` as an extra signal with a real key. No undocumented tricks. |
| L6 | **Posting comments.** It would need YouTube user authorization. | Read-only comments via API key, labelled as YouTube comments, fetched on demand and not stored. Full text or an expandable truncation, per the display rules. |
| L7 | **Resume inside YouTube playlists.** Progress can only be observed while playing on our site. | Reliable resume for individual and curated-playlist videos; best-effort index and time for YouTube playlists, labelled accordingly. |
| L8 | **Legacy `/c/` channel URLs.** `channels.list` accepts ID, handle, and username only. | Support channel IDs, `@handle`, and `/user/` URLs. For `/c/`, use a confirmed `search.list` lookup (100 calls/day limit) or ask for the handle. |

### 4.2 Restricted by YouTube policy

| # | Item | Handling |
|---|---|---|
| R1 | **Multi-channel aggregation — the top project risk.** III.I.1 bars replicating YouTube's core experiences without "significant independent value". III.E.2 limits aggregating data across content owners; it doesn't say whether that covers listing videos. The guide's unacceptable example is mass-aggregating embeds into "an identical copy of YouTube". | **I can't determine this from the documents.** Build for independent value: human curation, the knowledge network, articles, and an identity distinct from YouTube. **Your action:** apply for the API Compliance Audit before public launch. I'll prepare the material in Phase 9. Launching before clearance risks losing API access. Explicit permission from channel owners would also help. |
| R2 | **30-day data limits.** Statistics can't be stored beyond 30 days, and the policy requires verifying every 30 days that videos still exist. The guide also says derived-metric and statistics storage is limited to audited developers from 2026-06-01. | The refresh job is **mandatory**: `metadataFetchedAt` is indexed, the cadence and quota budget are configurable, and it can run from the admin or a protected cron endpoint. Removed videos are unpublished and CTAs to them hidden. Apply 30 days to all stored API data, including import previews. Statistics are off by default (D6) and never used for ranking. |
| R3 | **Privacy policy before access** (III.A.2), versus the spec's "no interrupting guests". The policy must link Google's privacy policy, disclose cookies, explain revocation, and give a contact. | A one-time, non-blocking first-visit notice with footer links. Whether this satisfies "agree" is a question for the audit. **You'll need to supply** the contact details and approve the legal text. |
| R4 | **Attribution per item** (III.F.2). One general attribution isn't enough. | A YouTube source label on every card, search result, and playlist item. Titles stay unmodified. |
| R5 | **Player rules.** Minimum 200×200; no autoplay until over half visible; one auto-playing player; no background play; no hiding end-of-video related links. | IntersectionObserver threshold above 0.5. Pause when hidden or scrolled away. "Preload next" means thumbnail and API script, not a hidden player. **On video end, stay on the end screen and show "next" outside the player, with no auto-skip.** |
| R6 | **Internal metrics** (III.E.4.h). They must be clearly disclosed as not from YouTube. | "Popular" in Explore uses real on-site usage only, is labelled, and stays hidden until there is enough data. |
| R7 | **Referrer required** (player error 153). | Set `Referrer-Policy: strict-origin-when-cross-origin`, plus `origin` and `enablejsapi`. Handle errors 2, 5, 100, 101/150 and 153. Record `embeddable` at import and exclude non-embeddable videos. |
| R8 | **Quota.** 10,000 units/day by default. `channels`, `playlistItems`, `videos` and `commentThreads` cost 1 unit each; `search.list` has its own limit of 100 calls/day. | 100,000 videos cost about 2,000 units per refresh, so it fits. Track estimated use per Pacific-time day, never retry `quotaExceeded`, and pause jobs for resumption. |

### 4.3 Different approach than a naive build

- **Thumbnails** load directly from YouTube instead of through `next/image` optimisation, so they aren't re-processed or re-hosted.
- **Long imports** can't rely on one long request. The browser drives small resumable steps against a persisted `ImportJob`, providing progress, cancel and resume without a queue.
- **Rate limiting** uses a MongoDB collection with TTL, so it works across instances without Redis.
- **CSP:** nonce-based CSP would make public pages dynamic. Admin gets a strict policy. Public pages get a compatible policy (`frame-src` YouTube, `base-uri`, `object-src`, `frame-ancestors`).
- **Spec routes:** "Following" in §5.1 is future-only, so that control is omitted under §1.5. Soft deletion uses `archivedAt`, keeping the `DRAFT`/`PUBLISHED` statuses exact.
- **Instruction precedence:** §1.3 and §32 say "don't stop at a plan"; your instruction to wait for approval takes priority.

## 5. Architecture

A modular monolith, following the structure in §3.1.

```text
Browser ── YouTube IFrame API (playback, directly from YouTube)
   │
Next.js: Server Components (default) │ Client islands (feed, editor, importer, save)
   │
Server Actions (admin mutations) │ Route Handlers (feed, search, signals, import steps, cron)
   │  Zod validation → rate limit → authorization → service
features/<domain>/ services  ── lib/youtube ── YouTube Data API v3
   │                         └─ lib/storage ── local or S3-compatible
lib/prisma ── MongoDB (replica set)
```

**Rules**
- Only `features/*/service` files touch Prisma, and each privileged service calls `requirePermission()` itself.
- `lib/youtube` is the only API caller. It handles validation, normalisation, quota accounting, and classified errors with retry only for transient failures.
- Arabic text sits in one central strings module, with logical CSS everywhere. That keeps later localisation possible without building i18n now.

**Feed player:** one active player plus thumbnails for all other cards. Phase 1 chooses between (a) create/destroy per card and (b) one reused player moved into position with `loadVideoById`. Option (b) may preserve unmuted state on iOS, so real-device results decide.

**Recommendation scoring** (pure, testable functions; weights stored in `ApplicationSetting`)
- `score = interest weight + positive signals − negative signals`, with decay; exploration is applied as a configurable share of feed slots.
- Each page allocates slots across categories by score. An exploration share goes to other categories, with limits on consecutive same-category and same-channel items.
- Each category is ordered by indexed `(feedKey, _id)`. An opaque cursor stores per-category position, which gives stable order and no duplicates in a session.
- A skip counts only if playback really started. Completion counts only from observed playback. No single long watch makes a large change.
- Guest signals stay in `localStorage` and are sent as validated hints, then merged on sign-in. There is no inference of beliefs or identity.

## 6. Search

- **Normalisation:** remove tashkeel and tatweel, unify أ/إ/آ→ا and ى→ي, and map ة→ه in search fields only. Displayed text never changes. Each mapping has tests, and §17's warning about meaningful distinctions is reviewed against real Arabic queries.
- **Clitics:** MongoDB doesn't stem Arabic, so "الصلاة" and "صلاة" wouldn't match. `searchText` also stores tokens without the leading ال.
- **Queries:** per-type text queries behind a single service with a filter by type and pagination per type. Suggestions use anchored prefix search on normalised titles.
- **Known limit:** there's no deep Arabic morphology, such as the prefixes و and ب. Atlas Search stays a later option if real use shows a need.

## 7. Database design

All IDs are `ObjectId`. Every model has timestamps where meaningful. Each relation is enforced in services because MongoDB has no foreign keys.

**Identity and users**
| Model | Key fields | Constraints and indexes |
|---|---|---|
| `User` | email, name, image, `role`, `permissionGrants[]`, `deactivatedAt` | unique email; role index |
| `Account`, `Session` | as the Auth adapter requires | unique provider + account ID; unique token; TTL on expiry |
| `UserPreference` | userId, onboarding state, sound preference | unique userId |
| `UserInterest` | userId, categoryId, selected, explicitWeight, behaviourScore, lastSignalAt | unique user + category |
| `Favorite` | userId, entityType, entityId | unique on all three; user + createdAt |
| `UserActivity` | userId, entityType, entityId, action, occurredAt | user + occurredAt; configurable TTL for raw signals |
| `ViewingProgress` | userId, videoId, playlistId?, position, duration, completed | unique user + video + playlist |

`VerificationToken` is omitted because Google-only sign-in doesn't use it (§20.1 says "if required"). Roles are an enum plus per-user grants, with the permission matrix in code; a separate `Role` collection is unnecessary.

**Taxonomy and knowledge**
| Model | Key fields | Constraints and indexes |
|---|---|---|
| `Category` | title, slug, description, icon, cover, order, isActive, parentId | unique slug; parent; order |
| `Topic` | title, slug, intro, description, cover, categoryId, parentId, isFeatured, status, archivedAt, searchText | unique slug; featured; updatedAt; text |
| `TopicRelation` | fromId, toId, type (`RELATED`, `COMPLEMENTARY`) | unique triple; self-links rejected; symmetric pairs stored in canonical order |
| `Library` | name, slug, description, intro, cover, isFeatured, order, parentId, status, searchText | unique slug; featured + order; text |
| `LibraryRelation` | fromId, toId | unique pair; self-links rejected |
| `ContentRelation` | sourceType/Id, targetType/Id, relationType (the six in §13.2), note, createdById | unique combination; lookup by source and by target |
| `Collection`, `CollectionItem` | editorial groupings for Explore | collection + position; unique item in a collection |

**Content**
| Model | Key fields | Constraints and indexes |
|---|---|---|
| `YouTubeChannel` | youtubeChannelId, handle, title, thumbnail, uploadsPlaylistId, lastSyncedAt, metadataFetchedAt, isActive | unique channel ID; unique handle is avoided (handles can change) |
| `Video` | youtubeVideoId, `kind`, `classification`, status, archivedAt, publishedAt, channelId, categoryId, YouTube fields (title, description, thumbnails, duration, tags, ytPublishedAt), `stats` (embedded, with fetchedAt), embeddable, availability, metadataFetchedAt, `cta` (embedded), `topicIds[]`, `libraryIds[]`, `feedKey`, searchText | **unique youtubeVideoId**; feed index on status, kind, category, feedKey, _id; multikey topic and library indexes with publishedAt; metadataFetchedAt; text |
| `Article` | title, slug, excerpt, cover, `body` (Tiptap JSON), `headings`, sources (embedded), seo (embedded), readingMinutes, status, authorId, assigneeIds[], categoryId, publishedAt, archivedAt, searchText | unique slug; status + publishedAt; category; assignee; text |
| `ExternalResource` | title, slug, description, sourceName, url, cover, status, searchText | unique slug; unique URL; text |
| `Playlist` | `type`, slug, **sourceKey**, youtubePlaylistId?, title, description, cover, channel info, syncStatus, itemCount, status, isFeatured, searchText | unique slug; unique sourceKey; text |
| `PlaylistItem` | playlistId, videoId, position, note | unique playlist + video; playlist + position |
| `ReviewNote` | entityType, entityId, authorId, body, resolvedAt | entity + createdAt |

**Explicit join models** (each with a compound unique index and an index on both sides)

`ArticleTopic`, `ArticleLibrary`, `ArticleVideo`, `ArticlePlaylist`, `VideoTopic`, `VideoLibrary`, `PlaylistTopic`, `PlaylistLibrary`, `ResourceTopic`, `ResourceLibrary`, `LibraryTopic`.

Joins are the source of truth. `Video.topicIds[]` and `libraryIds[]` are copies for fast feed filtering, updated in the same transaction by one service function, with a repair script in `scripts/maintenance`. Related articles use `ContentRelation`.

**Operations**
| Model | Key fields | Constraints and indexes |
|---|---|---|
| `ImportJob` | channelId, type (`IMPORT`, `SYNC`), status, pageToken, counters, errors[], createdById, cancelRequestedAt | status + createdAt |
| `ImportCandidate` | jobId, youtubeVideoId, metadata snapshot, classification, selected, assignments, result, expiresAt | unique job + video; **TTL within 30 days** |
| `AuditLog` | actorId, actor snapshot, action, entityType, entityId, metadata, createdAt | entity; actor; createdAt; **no TTL**; append-only API |
| `ApplicationSetting` | key, value, updatedById | unique key |
| `ApiQuotaUsage` | day (Pacific), units, per-endpoint counts | unique day |
| `RateLimitBucket` | key, count, expiresAt | unique key; TTL |

**Lifecycle:** publishing is `DRAFT → PUBLISHED` only, and `archivedAt` hides content and keeps references intact. Public queries always filter by published and not archived, so a CTA or relation to hidden content simply doesn't render. Hard deletes require confirmation, remove joins in a transaction, and are audited.

## 8. Implementation phases

These follow §1.4's order. **Every phase must pass these gates before the next begins:** `tsc --noEmit`, ESLint, unit and integration tests, `prisma validate`, `next build`, and a `PROJECT_STATUS.md` update. Each phase also keeps loading, empty and error states, RTL, and accessibility in scope for what it adds.

### Phase 1: Foundation and validation spikes
- **Objective:** a pinned, working foundation, with the riskiest assumptions proven.
- **Features:** project setup; the full schema; indexes script; env validation at startup; Prisma singleton; replica-set setup; error and logging conventions; test tooling; first-super-admin bootstrap script. **Temporary spikes, deleted afterwards:** feed gestures, autoplay, and player reuse on real iOS and Android; `embedWidth/Height` as a vertical signal (needs an API key); `db push` leaving script-made indexes intact.
- **Files:** `package.json`, `prisma/schema.prisma`, `scripts/database/create-indexes.ts`, `scripts/database/bootstrap-super-admin.ts`, `src/lib/prisma/`, `src/config/env.ts`, `src/lib/errors/`, `.env.example`, `README.md`, `PROJECT_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`, Vitest and Playwright config.
- **Depends on:** your approval.
- **Accepted when:** clean install works from the lockfile; schema validates and pushes; indexes exist; missing env fails with clear messages; spike results are recorded and D2's final layout confirmed; bootstrap creates exactly one super admin with no hardcoded account.
- **Tests:** env validation; index-script idempotence; integration test of a transaction and of a duplicate-key conflict.
- **Review stop:** results presented to you, per D8.

### Phase 2: Design system and application shell
- **Objective:** the premium, dark-first, RTL look across the app.
- **Features:** tokens from §4.3; primary font (IBM Plex Sans Arabic, self-hosted via `next/font`, with a specimen including Quranic text to confirm legibility); shadcn in RTL mode; bottom navigation on mobile and a compact sidebar on desktop; the five destinations; skeleton, empty, and error patterns; prose styling for articles.
- **Files:** `src/app/layout.tsx`, `src/app/globals.css`, `src/components/ui/*`, `src/components/layout/*`, `src/components/shared/*`, `src/config/strings.ar.ts`, `src/app/(public)/layout.tsx`, `error.tsx`, `not-found.tsx`.
- **Depends on:** Phase 1.
- **Accepted when:** `dir="rtl"` and `lang="ar"` everywhere; correct at 360, 768, and 1440 px; no physical-direction classes; mixed Arabic and English renders properly; navigation contains no dead controls (unbuilt destinations aren't shown as working).
- **Tests:** Playwright screenshots and overflow checks at three widths; axe accessibility checks; contrast of tokens; lint rule for direction classes.

### Phase 3: Authentication, permissions, preferences, taxonomy foundations
- **Objective:** optional sign-in, server-enforced roles, and stored interests.
- **Features:** Google sign-in with database sessions; the permission matrix for all five roles with per-user grants; `requirePermission`; guarded admin shell and minimal layout; audit logger; rate limiter; category and topic services with seed for the §10 categories; onboarding (skippable); `/interests`; guest preferences with merge on sign-in; scoring functions.
- **Files:** `src/lib/auth/`, `src/lib/permissions/`, `src/features/{auth,users,preferences,categories,topics,recommendations}/`, `src/app/auth/signin/`, `src/app/(public)/interests/`, `src/app/api/auth/[...nextauth]/`, `src/app/(admin)/admin/layout.tsx`, `src/lib/rate-limit/`, `src/features/admin/audit.ts`, `scripts/database/seed-taxonomy.ts`.
- **Depends on:** Phases 1–2.
- **Accepted when:** guests are never blocked; preferences survive sign-in; a deactivated user loses access immediately; non-staff get denied at both route and service level; client role data is never trusted.
- **Tests:** unit tests for the permission matrix, scoring, and preference merge; integration tests for unauthorized operations and audit writes; E2E with a seeded session and interest selection as a guest.

### Phase 4: YouTube integration and Shorts feed
- **Objective:** the core product experience.
- **Features:** `lib/youtube` client; URL and ID parsing with validation; metadata persistence; quota tracking; 30-day refresh job (admin trigger plus protected cron); player component and manager (one active player, lifecycle, errors, autoplay handling, muted start); For You and category feeds with scored allocation and cursor pagination; card with attribution, CTA, save, and share; keyboard and gesture navigation; `/shorts/[id]`; `/videos/[id]`; read-only comments; dev-only seed using a CLI import of real IDs (never shipped as production data).
- **Files:** `src/lib/youtube/*`, `src/features/{youtube,shorts,recommendations}/*`, `src/components/{feed,video}/*`, `src/hooks/useActivePlayer.ts`, `src/app/(public)/page.tsx`, `src/app/(public)/shorts/[id]/`, `src/app/(public)/videos/[id]/`, `src/app/api/feed/`, `src/app/api/signals/`, `src/app/api/comments/[videoId]/`, `src/app/api/cron/youtube-refresh/`, `scripts/youtube/`.
- **Depends on:** Phases 1–3, plus spike results.
- **Accepted when:** only one video ever plays; no player is created for off-screen cards; nothing covers the player; feed renders use no YouTube API calls; no duplicates across pagination; removed or non-embeddable videos are handled; stale data is refreshed or withdrawn; missing API key gives a clear disabled state rather than faked results.
- **Tests:** unit tests for ID and URL parsing, normalisation, cursors, allocation, and exploration ratio; integration tests with mocked API responses including `quotaExceeded` and `commentsDisabled`; E2E feed navigation with a stubbed player; manual real-device checklist.

### Phase 5: Articles, editor, knowledge relationships, libraries, topic pages
- **Objective:** the editorial side and the knowledge network.
- **Features:** Tiptap editor (RTL, headings, lists, quotes, links, images with captions, footnotes, preview, draft save, publish); safe rendering; storage adapters with upload validation; article page with automatic table of contents, progress, references, and related content; searchable attach-pickers, all optional; `ContentRelation`; external resources; topic pages hiding empty sections; library landing pages; related Shorts carousel opening in an intercepting-route modal.
- **Files:** `src/features/{articles,topics,libraries}/*`, `src/components/{articles,topics,libraries}/*`, `src/lib/storage/*`, `src/lib/content/` (renderer and sanitiser), `src/lib/validations/`, `src/app/(public)/{articles,topics,libraries,resources}/**`, `src/app/(admin)/admin/{articles,topics,libraries,resources}/**`, `src/app/api/uploads/`.
- **Depends on:** Phases 1–4 (video infrastructure reused).
- **Accepted when:** a non-technical volunteer can draft and publish; a contributor can't publish without a grant; relationships are all optional; hostile content is neutralised on save and render; unsafe files are rejected; a resource is clearly marked as external and never copied automatically.
- **Tests:** unit tests for article and relationship validation, self-relation rejection, reading time, and table of contents; XSS payload suite; upload validation tests; integration test of article create and publish with relations; E2E article reading and topic exploration.

### Phase 6: Playlists and long-form experience
- **Objective:** the bridge from short clips to deeper learning.
- **Features:** YouTube playlist import and sync; curated playlists with drag-and-drop reordering including keyboard; detail page; item playback; progress and resume for signed-in users as limited by L7; attribution; related content; no forced order.
- **Files:** `src/features/playlists/*`, `src/components/playlists/*`, `src/app/(public)/playlists/**`, `src/app/(admin)/admin/playlists/**`, `src/app/api/progress/`.
- **Depends on:** Phases 4–5.
- **Accepted when:** curated playlists can mix channels; order persists; one video can be in several playlists; multiple curated playlists without YouTube IDs don't collide; progress appears only where reliable.
- **Tests:** unit tests for reordering and duplicates; integration tests for playlist creation and sync with mocked API; E2E playlist navigation.

### Phase 7: Admin dashboard and channel importer
- **Objective:** efficient high-volume operation by volunteers.
- **Features:** all 14 sections in §19.2; real-data overview; list views with search, filters, bulk select, and bulk category and topic assignment; **YouTube Channel Importer** with the 12-step workflow, all six filters, batched requests, resumable job, cancel, and result report; candidates never auto-published; Sync Channel with review before publication; integration status page showing configuration, quota, and refresh health; users and roles (super admin protected); audit log viewer; settings for scoring, exploration ratio, Short threshold, and refresh cadence; confirmation on destructive actions.
- **Files:** `src/features/admin/*`, `src/features/youtube/import/*`, `src/app/(admin)/admin/{shorts,youtube-importer,channels,categories,users,audit-logs,settings,youtube-status}/**`, `src/components/admin/*`, `src/app/api/admin/import/*`, `docs/ADMIN_GUIDE.md`, `docs/YOUTUBE_INTEGRATION.md`.
- **Depends on:** Phases 3–6.
- **Accepted when:** a real channel imports with valid credentials; re-import and sync create no duplicates; closing the browser and returning resumes the job; quota exhaustion pauses clearly; each role is verified on the server; an admin can't remove or override the super admin; every privileged action is audited.
- **Tests:** unit tests for import normalisation, classification, and duplicate detection; integration tests for the entire import, resume, cancel, sync, and role-change workflows with mocked API; integration tests calling privileged actions directly under each role; E2E admin access, publishing, and import preview.

### Phase 8: Explore, search, user library, personalisation
- **Objective:** discovery across the whole network.
- **Features:** the search service, page, suggestions, type filters, and pagination; editorial Explore with categories, featured topics, collections, libraries, playlists, selected articles, and new content; real-usage "popular" (labelled, hidden when data is thin); `/saved` and `/history`; duplicate-safe saves; final scoring tuning; reset interests.
- **Files:** `src/features/search/*`, `src/lib/search/normalize.ts`, `src/components/{search,libraries}/*`, `src/app/(public)/{explore,search,saved,history}/**`, `src/features/users/library.ts`.
- **Depends on:** Phases 3–7.
- **Accepted when:** Arabic variants find the same content; results are real and show the correct source label; Explore differs from For You and isn't personalised by default; saved items work across devices and can be removed.
- **Tests:** unit tests for normalisation with a real Arabic query table and recommendation ordering; integration tests for search on all six types and for saves; E2E guest browsing, search, and saved content.

### Phase 9: Hardening and production readiness
- **Objective:** verified quality, not just compilation.
- **Features:** full security review against §21; headers and CSP; SEO metadata, Open Graph, JSON-LD, sitemap, robots, canonical Arabic URLs, `noindex` for admin and private pages; privacy and terms pages; account data deletion (if approved); performance profiling of actual bottlenecks; accessibility pass; complete documentation set in §31; final report per §32; **API Compliance Audit material**.
- **Files:** `src/lib/seo/*`, `src/app/sitemap.ts`, `src/app/robots.ts`, `next.config.ts` headers, `src/app/(public)/{privacy,terms}/`, `docs/{PRODUCT_SPECIFICATION,ENVIRONMENT_SETUP,DEPLOYMENT}.md`, `docs/YOUTUBE_COMPLIANCE_AUDIT.md`.
- **Depends on:** all prior phases.
- **Accepted when:** every §30 criterion is individually checked and recorded; no dead controls, using a crawl of visible actions plus manual review; no secrets in the client bundle; no stack traces reach the public; compliance checklist from section 4 is verified item by item.
- **Tests:** all §27 gates; complete E2E suite in mobile and desktop profiles; Lighthouse and axe on key pages; query plans checked with `explain` on feed and search; dependency audit; bundle secret scan; real credentials smoke test (Google sign-in and an actual channel import) if credentials are available. Any test that can't run is reported with the reason.

## 9. Requirements only you can provide

| Item | Needed by | Without it |
|---|---|---|
| MongoDB Atlas URI or local replica set | Phase 1 | Local replica set still works for development |
| A YouTube API key | Phase 1 spike and Phase 4 | Built and tested with mocks; real import remains unverified |
| Google OAuth client ID and secret | Phase 3 | Sign-in remains unverified against real Google |
| Real iOS and Android phones for testing, or your help running the spike | Phase 1 | L2 and L3 remain unproven; emulators don't fully reproduce them |
| Super admin Google account email | Phase 3 | Set when running the bootstrap script |
| Privacy contact, legal entity or responsible party, legal text review | Phase 9 | Pages can't be finalised |
| API Compliance Audit submission | Before public launch | R1 and R2 remain open risks |
| Storage provider, if using S3-compatible storage | Before production | Local adapter only |

## 10. End-to-end verification

At the end, the app is run locally against a real replica set, and this path is exercised on mobile and desktop profiles:

1. Guest opens the home feed, picks or skips interests, scrolls, and confirms only one video plays.
2. Guest follows a CTA, reads an article, opens a related Short, explores a topic, a library, and a playlist, and searches with Arabic spelling variants.
3. User signs in; guest preferences are kept; saves appear on another session; history and resume work.
4. Bootstrapped super admin assigns roles. A contributor drafts but can't publish, and an editor can publish only if granted permission.
5. Admin imports a channel: preview, filters, selection, assignment, result report. Re-running sync produces no duplicates.
6. Audit logs show each action, and direct calls to privileged endpoints under low roles are refused.
7. All §27.4 gates pass, and the §30 checklist and final §32 report are completed.

## 11. Sources

- YouTube: [Developer Policies](https://developers.google.com/youtube/terms/developer-policies), [Policy Guide](https://developers.google.com/youtube/terms/developer-policies-guide), [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality), [IFrame API](https://developers.google.com/youtube/iframe_api_reference), [Quota costs](https://developers.google.com/youtube/v3/determine_quota_cost), [channels.list](https://developers.google.com/youtube/v3/docs/channels/list), [Shorts help](https://support.google.com/youtube/answer/15424877)
- Prisma: [Upgrade to v7](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-to-prisma-7), [MongoDB connector (v6)](https://www.prisma.io/docs/v6/orm/overview/databases/mongodb), [CRUD (v6)](https://www.prisma.io/docs/orm/v6/prisma-client/queries/crud), [Full-text search (v6)](https://www.prisma.io/docs/orm/v6/prisma-client/queries/full-text-search)
- MongoDB: [Text search languages](https://www.mongodb.com/docs/manual/reference/text-search-languages/)
- Next.js: [Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), [Middleware to proxy](https://nextjs.org/docs/messages/middleware-to-proxy)
- Auth: [Better Auth security update, July 2026](https://better-auth.com/blog/security-update-july-2026), [next-auth v5 beta discussion](https://github.com/nextauthjs/next-auth/discussions/13382)
- Editor: [Tiptap text direction](https://tiptap.dev/docs/examples/basics/text-direction)
- Package versions and peer ranges: npm registry, read 2026-11-04.
