# Architecture

A modular monolith on Next.js App Router, TypeScript, Prisma, and MongoDB. There are no microservices, queues, or external search engines.

This document describes what exists now and is updated each phase. The target architecture is in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Current structure

```text
src/
  app/
    (public)/          Public pages inside the app shell: the feed, /shorts/[id], /videos/[id], /articles, /topics, /libraries, /playlists, /resources, /explore, /search, /saved, /history, /account, /privacy, /terms, /interests, /auth/signin, dev-only /design-system
    (public)/@modal/   Shows a Short over the page that linked to it
    (admin)/admin/     Guarded dashboard, with the 14 sections in §19.2
    api/               auth, categories, preferences, feed, signals, favorites, history, account, search suggestions, Explore's topics, comments, uploads, progress, cron, admin
    media/             Serves uploads for the local storage provider
    spike/feed/        Temporary device test
    not-found.tsx, global-error.tsx, globals.css, layout.tsx
  components/
    ui/                shadcn components
    layout/            App shell, navigation, account menu
    shared/            State messages, loading, brand mark
    preferences/       Interests state, first-visit prompt, interests page
    providers/         Session provider for client islands
    admin/             Dashboard shell and navigation, YouTube status panel
    admin/content/     Lists, forms, searchable pickers, link manager, image field, publish and delete controls
    articles/          Reading progress, save and share, and the editor (articles/editor)
    knowledge/         Cards and sections for each content type, save and share, recording views
    search/            The search box and its suggestions
    account/           Deleting an account
    legal/             The privacy notice, and the layout of the legal pages
    explore/           The one part of Explore that follows chosen interests
    library/           Rows, tabs, and removal for saved items and history
    admin/collections/ Collection forms and item manager
    playlists/         The playlist page's player, item list, and progress
    admin/playlists/   Playlist forms and the drag-and-drop item manager
    admin/importer/    The importer's job screen, and channel controls
    admin/videos/      The bulk list, shared with articles, and the video editor
    admin/system/      Categories, users, and settings
    feed/              The Shorts feed and its cards
    video/             Video page and modal, comments, save and share
  hooks/               useActivePlayer and usePlaylistPlayer, which each manage a page's one YouTube player
  config/
    feed.ts            Player strategy and visibility thresholds
    env.ts             Environment validation
    startup.ts         Exits the server if configuration is invalid
    navigation.ts      The five destinations
    strings.ar.ts      All interface text
  instrumentation.ts   Runs the startup check
  features/
    admin/             Audit logger, overview, users list, audit list, settings, integration status
    articles/          Articles, who may edit them, review notes
    content/           What content types share: public filter, slugs, cursors, card fields, resolving mixed references
    search/            Search across content types, and suggestions
    seo/               What the sitemap lists
    explore/           Explore's sections, popular content, topics for chosen interests
    collections/       Editorial collections
    libraries/         Libraries
    media/             Image uploads
    playlists/         Playlists, their items, viewing progress
    relationships/     Links between content, searchable selection, cleaning up references
    resources/         External resources
    categories/        Categories, their validation, and the starting taxonomy
    topics/            Topics
    preferences/       Interests, onboarding state, merging guest choices
    recommendations/   Pure scoring functions, their settings, watch signals
    shorts/            Feed allocation, cursor, video cards, publishing
    youtube/           Channel importer (import/), channels, metadata refresh, playlist sync, comments, settings
    favorites/         Saved videos, articles, topics, and playlists
    users/             First super admin bootstrap, role and account management, saved items, history, continue watching
  lib/
    youtube/           The only caller of the YouTube Data API, ID parsing, the IFrame API loader
    auth/              NextAuth configuration, the current actor, page guards
    content/           The allow-list for article bodies, their analysis, and the renderer
    errors/            Safe public errors
    http/              API route error handling, origin check, body validation, Server Action wrapper
    logger/            Structured logging with secret redaction
    permissions/       The role and permission matrix
    prisma/            Database client, index management, transaction retry
    rate-limit/        Rate limiter on MongoDB
    search/            Arabic normalisation, and turning a query into search terms
    seo/               Canonical addresses, structured data, and writing it safely
    slug/              Arabic slugs
    storage/           Upload validation and processing, local and S3-compatible adapters
    utils/             Class name helper, date and number formatting
    validation/        Connects Zod to React Hook Form
prisma/
  schema.prisma        Data model
  mongo-indexes.ts     Text and TTL indexes
scripts/
  database/            Local replica set, indexes, first super admin, starting taxonomy
  youtube/             Development-only video import, temporary embed-dimensions test
tests/
  unit/                Design token contrast and the RTL lint rule
  integration/         Tests against a real MongoDB replica set
  e2e/                 Browser tests on their own replica set. spike-feed.spec.ts is temporary.
```

The visual system is documented in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

## Conventions

- **Data access lives in `features/*` services.** UI components never query the database.
- **Errors:** expected failures throw `AppError` with a safe message. `toPublicError` turns anything else into a generic message, so internals never reach users.
- **Logging:** server code uses `logger`, which writes one JSON object per line and removes secrets. Never pass secrets on purpose, because redaction is a safety net that works on key names and known URL patterns.
- **Configuration:** server code reads settings through `getEnv()`. Messages name the variable but never include its value.
- **Secrets stay on the server.** A check of the production client bundle found no secret names or values.

## Authentication and authorization

Sign-in is optional and uses Google through `next-auth` 4, with sessions stored in MongoDB.

| Rule | Where it's enforced |
|---|---|
| Who is making a request | `getCurrentActor()` in `lib/auth/session.ts`. It's the only source, and it reads the database each time, so a role change applies to the next request. |
| What they may do | `assertPermission()` at the start of each privileged service, using the matrix in `lib/permissions`. Pages guard themselves too, but only for a better response. |
| Deactivated people | The auth adapter treats their session as absent on every read, and deactivating also deletes their sessions |
| Ownership | Preference services take no user ID, and use only the actor's own |
| Writes from other sites | `assertSameOrigin()` on cookie-authenticated API writes |
| Audit log | `recordAudit()` inside the same transaction as the change |
| Sign-in data | Only name, email, and image are copied from Google, and tokens aren't stored. Only `openid email profile` is requested. |

**Public pages don't read the session on the server,** which keeps them cacheable. A client island asks `/api/auth/session` after the page loads. That response says only whether to show the dashboard link, never a role or permissions.

**Each admin page must call `checkPageAccess` itself** as well as the layout, because a layout isn't re-rendered when moving between its pages.

### Roles

| Permission | Contributor | Reviewer | Editor | Admin | Super admin |
|---|---|---|---|---|---|
| Open the dashboard | Yes | Yes | Yes | Yes | Yes |
| Create drafts | Yes | | Yes | Yes | Yes |
| Edit assigned content | Yes | Yes | | | |
| Edit any content | Grant | Grant | Yes | Yes | Yes |
| View any content, add review notes | | Yes | Yes | Yes | Yes |
| Publish, archive | Grant | Grant | Grant | Yes | Yes |
| Delete content | | | | Yes | Yes |
| Topics, relationships, libraries, playlists | Grant | Grant | Yes | Yes | Yes |
| YouTube import | Grant | Grant | Grant | Yes | Yes |
| Categories | | | | Yes | Yes |
| View users, view audit log | | | | Yes | Yes |
| Manage users, change settings | | | | | Yes |

"Grant" means a super admin can give it to that person individually. Grants have no effect on someone who isn't staff, and can never include account or settings powers.

The super admin can't be demoted, deactivated, or changed by anyone, including themselves, and nobody can be promoted to super admin outside the bootstrap command.

Roles are managed at `/admin/users`.

**Articles have one more rule:** `content.editAssigned` covers drafts the person wrote or was assigned, and stops once the article is published. Links between content are managed with `topics.manage` and `libraries.manage`, while links chosen on an article's own form need only permission to edit that article (§13.3).

## Interests and scoring

Guests keep their interests in browser storage, and signed-in people in their account. `PreferencesProvider` is the one source for the public site. After sign-in it sends a guest's choices to `/api/preferences/merge` and removes them from the browser only once the server has them.

Scoring lives in `features/recommendations/scoring.ts` as pure functions, with weights stored in `ApplicationSetting`:

```text
score = explicit weight × selected interest weight + behaviour score decayed over time
```

## YouTube integration

`lib/youtube` is the only caller of the Data API. `client.ts` validates responses, records quota per Pacific-time day, retries only temporary failures, and treats `quotaExceeded` as final: it isn't retried, and no further calls are made until YouTube's reset. Error objects and logs never contain the request URL, which holds the key.

| Rule | How it works |
|---|---|
| Feed rendering never calls the API | The feed reads stored data only. A test asserts no such request is made. |
| Data refreshed or removed within 30 days | `runMetadataRefresh` handles the oldest first, from 25 days on, within a set number of batches per run. Run it from `/admin` or the protected `/api/cron/youtube-refresh`. **Production needs a daily scheduled call to this endpoint.** |
| Past 30 days with nothing fresher | The stored YouTube fields are cleared and the video leaves public pages, even with the API off or out of quota. The record and its links stay, and a later successful refresh restores it. |
| Deleted videos | Found by the same refresh, because a missing ID means it's gone. Their YouTube data is cleared. |
| Non-embeddable videos | Marked, and excluded from public pages |
| Nothing published automatically | Imports are drafts. Publishing needs a person's review (`reviewedAt`, set by assigning a kind), and a Short also needs a category. |
| Statistics | Off by default (`youtube.settings`). When off, they're neither requested nor stored, and existing ones are cleared on refresh. |
| Comments | Read-only, fetched on request, never stored. `commentsDisabled` is remembered, so later visits spend no quota finding out. |

## The feed

`GET /api/feed` returns a page from `features/shorts/feed.service.ts`:

1. **Scores:** every active category is ranked with the functions above.
2. **Slots:** `allocateCategorySlots` shares the page by score, and gives the configured exploration share to categories with no positive score. With no history, the mix is even.
3. **This visit:** the browser sends what happened since the page opened, as `momentum` for categories and `channelMomentum` for channels. Completions, replays, and saves raise them and early skips lower them. It only changes this person's next pages, and is never stored. A category's score moves by `sessionMomentumWeight`, and `maxCategoryShare` stops one category taking over a page.
4. **Choosing channels:** `planFeedPage` decides each card's category and channel. A channel never returns within `channelSpacing` cards while another is available, even if that means borrowing from another category, and this carries across pages through the cursor. Bigger channels are likelier by the square root of their size, so one with most of the library can't dominate. If nothing else is left, the channel seen longest ago comes next.
5. **Reading:** each category and channel pair is read in `(feedKey, id)` order from a random start point chosen per session, wrapping around at the end. The cursor counts what's been read from each pair, which guarantees no repeats within a round and stays small. A cursor that outgrows a URL starts a new round.
6. **Rounds:** the feed has no end. Once everything has been shown, the browser starts again in a new order, and nothing repeats before that.

Signed-in people's interests come from their account. Guests' come from browser storage as request hints, which are validated and bounded. A guest's watching stays in the browser until they sign in.

### The player

**The home feed's player differs by the owner's decisions of 2026-11-05 and 2026-11-06, and `FeedPlayerPool` (`src/lib/youtube/feed-player-pool.ts`) manages it.** One player is active. Others wait buffered on the coming cards, primed one at a time, nearest first, once the active video has started. See [YOUTUBE_INTEGRATION.md](YOUTUBE_INTEGRATION.md). `FEED_BUFFER_AHEAD` turns this off, which puts the feed back on `useActivePlayer`, described below.

Everywhere else, `useActivePlayer` manages the one player. **Nothing may be placed in front of it.** All text and controls sit in the card's panel, outside the player, and the first-visit prompt is a slide in the feed rather than a dialog.

| Behaviour | Detail |
|---|---|
| Created only for the active card | Other cards show a thumbnail. "Preload" means the next thumbnail and YouTube's script. |
| Active | At 60% visible. Below 50%, it pauses. With no active video, the player is destroyed. |
| Autoplay | Always starts muted. The sound button calls the documented `mute` and `unMute`. |
| End of video | Stays on YouTube's end screen, and "next" is highlighted outside the player. No auto-skip. |
| Moving on | Keyboard (arrows, Page Up/Down, `m` for sound), the buttons, or scrolling the panel and margins |

`FEED_PLAYER_STRATEGY` in `src/config/feed.ts` chooses between one reused player and a new one per video. **It's provisional until real phones are tested.**

The browser tests use a stub of YouTube's script (`tests/e2e/support/test.ts`). They prove how the application behaves, not how real autoplay, sound, or swiping work on phones.

### Pages without a loading screen

`/shorts/[id]` and `/videos/[id]` deliberately have no `loading.tsx` above them, and neither does `/auth/signin`. A loading screen makes Next.js send a 200 status before the page runs, so hidden videos would no longer return 404, and redirects would stop being real redirects. Keep it that way: add `loading.tsx` inside a specific page's folder, and never at `(public)/`.

## Articles and rich text

Bodies are stored as Tiptap JSON, and never as HTML.

| Layer | What it does |
|---|---|
| `lib/content/document.ts` | The allow-list. It rebuilds a document from scratch, keeping only known nodes, marks, and attributes. Unsafe links lose their link but keep their text. It runs on save and again on render. |
| `lib/content/content-renderer.tsx` | Builds React elements and never uses `dangerouslySetInnerHTML`, so stored text can't become markup. The editor's preview uses the same renderer. |
| `lib/content/analysis.ts` | Headings and their anchors, reading time, footnotes, and plain text for search. These are recalculated on every save. |

`sanitize-html`, which the plan listed, isn't installed: there's no HTML to sanitise, so it would protect nothing.

**Editing:** `components/articles/editor`. Images enter only through upload, as a `figure` node with a caption. Footnotes are plain text held in an attribute. The editor is loaded only on its own screens, so it adds nothing to other pages.

**A published address can't change,** because it may already be shared or linked. Unpublish first if it must.

**Review notes** have no effect on publishing, so a reviewer never becomes a required stage (§19.4).

## Knowledge relationships

| Relationship | Where it's set | How it's saved |
|---|---|---|
| Article to topics, libraries, videos, playlists, and related content | The article's form | Replaced as a capped list when the article is saved |
| Topic or library to anything | The link manager on its page | One link at a time, immediately |

The link manager saves one at a time because a topic can hold thousands of videos, which a form can't carry, and two editors can't overwrite each other this way. `features/relationships/links.service.ts` is the only writer of `Video.topicIds` and `libraryIds`.

All relationships are optional, and public queries read only public targets, so a link to hidden content simply doesn't appear.

**Deleting** is permanent, asks first, and is audited. `purgeContentReferences` removes everything that points to content by type and ID, including saved items, review notes, and video CTAs. Sub-topics and sub-libraries move up rather than disappear. **Archiving** hides content and keeps every link, so it's what people should normally use.

## Playlists

| | Curated | YouTube |
|---|---|---|
| Made by | Staff, mixing any channels | Import by URL, needing `youtube.import` |
| Key | `cur:<uuid>` | `yt:<id>` |
| Title and description | Ours to edit | From YouTube, shown exactly and not editable |
| Items and order | Edited here, with drag and drop, keyboard, or arrows | Replaced on each sync |
| Plays through | One player, with `loadVideoById` | YouTube's own playlist player (`list`, `playVideoAt`) |
| Videos shown | Published ones only | Every available one, whatever its status here |

**Why YouTube playlists show unpublished videos:** YouTube's playlist player shows everything in the list, so our list has to match it. Those videos stay drafts, so they aren't in the feed or on topic pages, and have no page of their own until someone reviews them. Nothing is published by being imported.

**Sync** (`features/youtube/playlist-sync.service.ts`) fetches the details, enumerates the items, imports new videos as drafts, then replaces the items in one transaction, so an API failure leaves the stored list as it was. It stops at 500 items and says so. The daily refresh syncs up to 10 due playlists per run, which also covers YouTube's 30-day limit on stored data. A playlist past 30 days with nothing fresher, or deleted from YouTube, has its fields blanked, its items removed, and leaves public pages, while its links stay. A later sync restores it.

**Related playlists** are those sharing a topic. It's transparent and needs no extra data.

### Viewing progress

For signed-in people only, using what was really observed while playing on this site (limit L7). Reported on pause, at the end, every 20 seconds while playing, and when leaving. A guest's watching isn't sent, and they get a link to sign in, never a dialog.

| | Reliability |
|---|---|
| Curated playlists, and long videos on their own page | Reliable |
| YouTube playlists | Best effort, and labelled so. YouTube's player decides what plays, so the current video is read back from it, and resuming within a list may land imprecisely. |

Progress is kept per playlist, so one video watched in two places is two records. Rewatching doesn't undo "completed".

## Image uploads

`POST /api/uploads` → `features/media/uploads.service.ts` → `lib/storage`.

| Rule | How it works |
|---|---|
| Type | Decided from the file's first bytes, and never from its name or claimed type. JPG, PNG, and WebP only. SVG is refused, since it can carry scripts. |
| Content | Re-encoded to WebP with `sharp`, which removes metadata such as GPS positions and anything hidden after the image data |
| Size | 8 MB in, 40 megapixels at most, and resized to 2000px wide at most |
| Name | Always generated, so nothing from the upload reaches a path |
| Who | Staff who can change content, rate limited and audited |

The `local` provider keeps files in `STORAGE_LOCAL_DIR`, served by `/media`, because Next.js only serves `public` files that existed at build time. It doesn't persist on serverless hosts, so those need `s3`, which works with any S3-compatible provider. **The S3 adapter hasn't been run against a real provider.**

Images are removed from an article's text but not from storage, so unused files accumulate. That's harmless, and a cleanup can come later if storage cost matters.

## Pinned versions

These are exact on purpose. **Do not run an unpinned install or `npm update` on them.**

| Package | Version | Why it is pinned |
|---|---|---|
| `prisma`, `@prisma/client` | 6.19.3 | Prisma ORM 7 doesn't support MongoDB, and the npm `latest` tag for `prisma` pointed to an 8.0 release candidate when checked |
| `typescript` | 6.0.3 | `typescript-eslint` requires below 6.1, so TypeScript 7 breaks linting |
| `eslint` | 9.39.5 | Plugins in `eslint-config-next` don't accept ESLint 10. npm marks this version as past end of support. It runs only in development, and should move to 10 once those plugins allow it. |
| `next` | 16.4.5 | Latest stable when set up |
| `next-auth` | 4.24.15 | v5 is still in beta. Kept behind `lib/auth`. |

## Decisions verified in Phase 1

| Decision | Reason |
|---|---|
| `npm run db:sync` is the only way to push the schema | `prisma db push` deletes all 10 script-managed indexes. Tests record this. |
| `mongodb-memory-server` for tests and local development | A real replica set with no Docker or MongoDB install. Data persists across restarts when run through `npm run db:dev`. |
| Test setup runs `db push` asynchronously | A blocking call stalls `mongod`, whose output that same process reads, and hangs forever |
| Bootstrap guarded by a unique setting key | Counting super admins alone can't stop two simultaneous runs |
| The server exits on invalid configuration | By default, Next.js logs the error but keeps running and answers every request with a 500 |
| ESM project (`"type": "module"`) | Scripts use top-level `await` through `tsx` |
| `Referrer-Policy: strict-origin-when-cross-origin` set globally | The YouTube player fails with error 153 when no referrer is sent |

## Notes for later phases

**A Short opened from a page with a player:** the modal route would add a second player, so nothing on `/videos/[id]` or the feed links to `/shorts/[id]`. Keep it that way.

**The phone top bar** takes 52px from the player's space, and the category tabs another 52px. If the real-phone test finds the player too small, these are the first places to look.

**Saved videos** can be saved now, but `/saved` arrives in Phase 8, so there's nowhere to see them yet.

YouTube player methods don't exist until `onReady`, and people can swipe before that. The player manager holds the requested video and loads it once ready. The spike crashed without this.

## Search

`features/search/search.service.ts` runs one query for each content type against MongoDB text indexes. It's the only place that does, and it only reads stored data. Queries aren't stored or logged.

| Step | What happens |
|---|---|
| Normalise | `lib/search` removes diacritics and elongation, unifies أ/إ/آ to ا, ى to ي, ة to ه, and Persian ی and ک, and converts digits. Stored text is normalised the same way. |
| Article | Words starting with ال are stored and searched in both forms, except الله and اللهم. |
| Particles | Words such as في and من are dropped from a query with other words, since the index has no stop words. |
| Direct matches | `$text`, sorted by score, with titles weighted 5 to 1. |
| Topics and categories | If the query names a topic or category, by title and not by a mention in its description, the content connected to it counts too, after the direct matches. So names don't have to be copied onto every item, and renaming one needs no reindexing. |

Pagination is by page number rather than cursor, because relevance order has no stable key to continue from. Results are capped at 25 pages for each type.

**Known limits.** Words are matched whole, so "صلاته" doesn't find "صلاة". The prefixes و, ب, ف, ل and ك aren't removed, so "الصلاة" doesn't find "والصلاة", because stripping them changes meanings: "والدين" (parents) would become "دين" (religion). Atlas Search remains an option if real use shows this matters. Suggestions match the start of titles only.

## Saved items and history

Each person's data is read using the ID in their session, never one from the request.

- **Saved items** can be videos, articles, topics, and playlists. An item that's no longer public stays listed, without its content, so it can be removed.
- **History** has one `UserActivity` record per person and item, moved forward on each visit and removed after 90 days. It's written from the browser, for signed-in people only, so public pages stay static. It has no effect on recommendations.
- **Popular** on Explore counts these records, so it counts people rather than visits. It's hidden until at least 3 public items each have at least 5 people in the last 30 days. YouTube's statistics aren't involved.

## Security headers

| Area | Policy | Where |
|---|---|---|
| `/admin` | Strict: scripts need a fresh nonce on each request | `src/proxy.ts` |
| Everything else | Allows inline scripts, because a nonce would stop pages being cached. Still limits framing, connections, plugins, and base and form targets. | `next.config.ts` |

All pages also send `X-Frame-Options`, `X-Content-Type-Options`, `Permissions-Policy`, and, in production, HSTS. These are layers on top of permission checks in services, and never a replacement for them.

`JsonLd` is the one use of `dangerouslySetInnerHTML`. It's for structured data rather than article content, and every `<` is escaped so a title can't close the script.
