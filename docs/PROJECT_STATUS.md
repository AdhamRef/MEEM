# Project status

Last updated: 2026-11-05

**Phases 2, 3, 5, 6, and 7 are implemented, and Phase 4 is implemented with its real-device check still open.** Phase 1 remains open, because it needs real phones and a real Short for the vertical-video check, and Phase 4's player choice and layout depend on those same results. The owner asked to proceed in this state. Nothing has been committed. Phase 8 has not started.

Everything the owner needs to do, across all phases, is in [OWNER_ACTIONS.md](OWNER_ACTIONS.md).

Plan: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) · Specification: [MASTER_SPECIFICATION.md](MASTER_SPECIFICATION.md)

## Phases

| Phase | Name | Status |
|---|---|---|
| 1 | Foundation and validation spikes | **IN PROGRESS: blocked on device testing and an API key** |
| 2 | Design system and application shell | **IMPLEMENTED: awaiting owner review** |
| 3 | Authentication, permissions, preferences, taxonomy foundations | **IMPLEMENTED: awaiting owner review. Real Google sign-in unverified (needs credentials).** |
| 4 | YouTube integration and Shorts feed | **IMPLEMENTED: awaiting owner review. Real phones unverified.** |
| 5 | Articles, editor, knowledge relationships, libraries, topic pages | **IMPLEMENTED: awaiting owner review. S3 storage unverified, and not yet tried by a real volunteer.** |
| 6 | Playlists and long-form experience | **IMPLEMENTED: awaiting owner review. Real phones unverified.** |
| 7 | Admin dashboard and channel importer | **IMPLEMENTED: awaiting owner review. A real channel import hasn't been run.** |
| 8 | Explore, search, user library, personalisation | NOT STARTED |
| 9 | Hardening and production readiness | NOT STARTED |

## Phase 1 acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Clean install works from the lockfile | **Met** | `npm ci` exit 0, re-run after Phase 2's dependencies. Lockfile unchanged. |
| Schema validates and pushes | **Met** | `prisma validate` passes. `npm run db:sync` applied it to a real replica set. |
| Indexes exist | **Met** | All 10 script-managed indexes and the schema's indexes were created. Re-running changes nothing. |
| Missing env fails with clear messages | **Met** | A production server exits with code 1, naming each bad variable and never printing values. |
| Bootstrap creates exactly one super admin, with no hardcoded account | **Met** | The real command ran against a throwaway database. A test with 4 simultaneous runs produced exactly 1. |
| Spike results are recorded and D2's final layout confirmed | **NOT MET** | Needs real iOS and Android phones. |

## Phase 1 spike results

| Spike | Result | Status |
|---|---|---|
| `db push` leaves script-made indexes alone | **False. It deletes all 10.** `npm run db:sync` is now the only way to push, and it restores them. | Resolved |
| TypeScript 6.0.3 with Next and the Prisma client | Compiles and lints | Resolved |
| One player, nothing in front of it, at least 200×200, no referrer error, in both player strategies | Pass in emulated Chromium on mobile and desktop profiles. Muted autoplay reached the playing state there. | Emulated only |
| Moving on before the player is ready | Crashed in reuse mode. Fixed, and recorded for Phase 4. | Resolved |
| **Swiping when the touch starts on the video (L2)** | Not tested. An emulated swipe was tried, but it reported no movement even from outside the player, where scrolling certainly works, so it can't measure this. It was removed. | **Needs real phones** |
| **Muted autoplay on real browsers (L3)** | Not tested | **Needs real phones** |
| **Which player strategy keeps sound on after one tap** | Not tested, so `recreate` versus `reuse` is undecided | **Needs real phones** |
| **`embedWidth/Height` as a vertical signal (L5)** | Run with the real key on two wide videos, including one of 19 seconds, which duration alone calls a Short candidate. Both reported wide, so the signal looks useful, but **no real vertical Short has been tried.** | **Needs a real Short's URL** |

### How to run the device test

1. Create `.env` with `cp .env.example .env`. The database doesn't need to be running.
2. Find this computer's local IP address (`ipconfig`), then start the server, replacing the example address:

   ```powershell
   $env:DEV_ALLOWED_ORIGINS="192.168.1.11"; npm run dev -- -H 0.0.0.0
   ```

3. On a phone on the same Wi-Fi, open `http://192.168.1.11:3000/spike/feed`. Windows Firewall may ask to allow Node.js.
4. Paste at least 3 real Short URLs, choose `recreate`, and start. Repeat with `reuse`.

Please report these for each of iPhone Safari and Android Chrome:

- [ ] Does the first video start playing by itself, muted?
- [ ] Does swiping work when the finger starts **below** the video?
- [ ] Does swiping work when the finger starts **on** the video?
- [ ] After "Turn sound on", does the **next** video keep sound in `recreate` mode?
- [ ] Does the next video keep sound in `reuse` mode?
- [ ] Any `AUTOPLAY BLOCKED` or `ERROR code` lines in the log on screen?
- [ ] Does the amount of space for the video feel acceptable (68% of the screen height)?

### How to run the API key test

Add `YOUTUBE_API_KEY` to `.env`, then pass some known Shorts and some normal wide videos. This costs 1 quota unit.

```bash
npx tsx scripts/youtube/spike-embed-dimensions.ts VIDEO_ID VIDEO_ID VIDEO_ID
```

## Phase 2 acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| `dir="rtl"` and `lang="ar"` everywhere | **Met** | Set on the root and global-error documents, with `DirectionProvider`. Browser test confirms. |
| Correct at 360, 768, and 1440 px | **Met** | No horizontal overflow on any page at any width, on both browser profiles. Screens reviewed by eye. |
| No physical-direction classes | **Met** | An ESLint rule rejects them, with 36 tests of the rule itself. Another test covers `globals.css`. |
| Mixed Arabic and English renders properly | **Met** | Reviewed by eye on `/design-system`, plus a browser test |
| Navigation contains no dead controls | **Met** | The 4 unbuilt destinations are dimmed, marked `aria-disabled`, and aren't links. A test confirms every enabled item returns 200. |

Also delivered, as the plan lists: tokens, the self-hosted font, shadcn in RTL mode, skeleton, empty and error patterns, and article typography. Accessibility scans with axe found no WCAG A or AA violations on any page.

## Phase 3 acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Guests are never blocked | **Met** | Browser tests: no dialogs, and every public page opens signed out. Signing in is only offered through a menu and links. |
| Preferences survive sign-in | **Met** | Browser test of the whole path, including when the merge fails: choices leave the browser only once the server has them. |
| A deactivated user loses access immediately | **Met** | Browser test with their session still stored: refused on the very next request. Deactivating also deletes their sessions. |
| Non-staff are denied at route and service level | **Met** | Each privileged service tested under all six roles and as a guest, called directly. The dashboard and API tested in the browser. |
| Client role data is never trusted | **Met** | Tests send roles in cookies, headers, and bodies. Bodies are rejected, and the rest is ignored. |

**Not verified:** real Google sign-in, which needs credentials. Tested up to the redirect: Google receives the right client, callback address, and only `openid email profile`. The return leg and first-account creation are covered only by tests of the adapter.

## Phase 4 acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Only one video ever plays | **Met in emulation** | Browser tests with both a stub and the real YouTube player. One player exists at any time. **Not confirmed on real phones.** |
| No player for off-screen cards | **Met** | Others show thumbnails. An empty tab or scrolling away destroys or pauses the player. |
| Nothing covers the player | **Met** | Checked at 25 points across the player, and the real player at 9 points. At least 200×200 at all tested sizes. |
| Feed renders use no YouTube API calls | **Met** | Integration and browser tests assert no such request. |
| No duplicates across pagination | **Met** | Tested across categories, random start points, wrap-around, and identical feed keys. |
| Removed or non-embeddable videos are handled | **Met** | With mocked API responses. They leave public pages and return 404. |
| Stale data is refreshed or withdrawn | **Met** | With mocked responses, including quota exhaustion and no API key. **Production needs a daily scheduled call to the refresh endpoint.** |
| A missing key gives a clear disabled state | **Met** | Comments and the admin panel explain it, and nothing is invented. |

**Not verified, and needed before this phase can close:**

- **Real phones:** autoplay, swiping on the player, sound carrying between videos, and whether the player has enough space. See the device test above.
- **Player strategy:** `FEED_PLAYER_STRATEGY` is `reuse`, chosen by reasoning and not by test results.

The manual checklist is the device test above, using `/spike/feed`. It can use the real feed instead once a key has imported videos.

## Phase 5 acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| A non-technical volunteer can draft and publish | **Met in a browser test** | The whole path through the real editor on both profiles: headings, bold, quote, list, footnote, link, image with caption, preview, save, publish. **No real volunteer has tried it**, and only they can judge comfort. |
| A contributor can't publish without a grant | **Met** | Tested at the service under each role, and in the browser. A grant allows it. |
| Relationships are all optional | **Met** | An article with none publishes and displays. Attaching through search is tested in the browser. |
| Hostile content is neutralised on save and render | **Met** | Payload tests on the allow-list, a saved-document test, and a browser test with content planted directly in the database: nothing executes. |
| Unsafe files are rejected | **Met** | Type comes from the file's bytes, and SVG, HTML, and corrupt files are refused. Metadata and hidden data are removed. Path tricks on the media route return 404. |
| A resource is clearly marked as external and never copied | **Met** | Marked on its card and page. The service accepts only a description and a link, and refuses a body. |

**Also delivered, as the plan lists:** the reading page with contents, progress, sources, and related content; topic pages hiding empty sections; library landing pages; related Shorts opening in a modal over the page; S3 and local storage adapters; and dashboard screens for all four content types.

**Limits of this phase:**

- **Playlists can be attached but aren't shown publicly,** until Phase 6 ships their pages.
- **Bulk selection and bulk assignment** arrive with Phase 7's list views, as the plan schedules them.
- **Linking a video still needs videos to exist,** and adding them needs the command line and an API key until Phase 7.
- **Structured data, the sitemap, and robots** arrive in Phase 9. Pages already have titles, descriptions, canonical addresses, and Open Graph.

## Phase 6 acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Curated playlists can mix channels | **Met** | Tested in the service and through the screens |
| Order persists | **Met** | After a reload, and it reaches readers. Reordered by mouse, keyboard alone, and arrows in the browser. A stale screen is refused, losing nothing. |
| One video can be in several playlists | **Met** | Removing it from one leaves the others |
| Several curated playlists with no YouTube ID don't collide | **Met** | Each gets its own required key |
| Progress appears only where reliable | **Met in emulation** | Saved and resumed in a second session with the player stub. Signed-in only. YouTube playlists are labelled as approximate. **Real playback on real phones isn't confirmed.** |

**Checked against the real YouTube API** on a throwaway database, using 9 quota units: importing videos, a missing ID, comments, refreshing, importing a playlist, a second sync with no duplicates, and a missing playlist. Statistics stayed off. This was a small public playlist and two public videos, so **a large playlist hasn't been tried for real**, only with mocked responses up to the 500-item limit.

**Limits of this phase:**

- **Saving a playlist** arrives with `/saved` in Phase 8.
- **Playlists can be attached to a video's CTA** only through the service, until Phase 7's screens.
- **A YouTube playlist stops at 500 items,** and the sync says so.

## Phase 7 acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| A real channel imports with valid credentials | **NOT VERIFIED** | Each API call it uses worked with the real key in Phase 6's check, apart from looking up a channel. The whole importer has run only with mocked YouTube responses. **Needs a real channel from the owner.** |
| Re-import and sync create no duplicates | **Met** | With mocked responses. A second import finds everything already imported, and a sync finds only what's new. |
| Closing the browser and returning resumes the job | **Met** | In the service, and in the browser with the review stage. Live discovery can't run in browser tests, which have the API off. |
| Quota exhaustion pauses clearly | **Met** | The job pauses with the reason, isn't retried, and resumes from the same page |
| Each role is verified on the server | **Met** | Services called directly under each role. Each screen also tested for who can open it. |
| An admin can't remove or override the super admin | **Met** | Tested as admin and as the super admin themselves, on screen and directly. Nobody can be promoted to super admin. |
| Every privileged action is audited | **Met** | Tested for imports, bulk actions, roles, settings, and categories, and readable on the activity log screen |

All 14 sections in §19.2 exist, and each is shown only to those allowed. Candidates are never published automatically.

**Limits of this phase:**

- **Bulk selection works per page of results,** up to 100 items at a time. The importer's "select all" is the exception, covering everything its filter matches.
- **Bulk assignment is on videos and articles,** the two types with both a category and topics.
- **Videos can be archived but not deleted.** Deleting would let a later import bring back something staff rejected.
- **The dashboard guide is in English,** while the people using it read Arabic. See the owner's list.

## Decisions

### Approved with the plan

| # | Decision |
|---|---|
| D1 | `next-auth` 4.x (stable) behind a thin `lib/auth` wrapper |
| D2 | Feed: player on top, with title, channel, CTA, and actions outside the player. **The final layout is confirmed after device testing.** |
| D3 | One `Video` model with `kind` (`SHORT` or `LONG_FORM`) instead of a separate `Short` model |
| D4 | One primary category per video or article, with many topics |
| D5 | Additions approved: `/privacy`, `/terms`, one-time privacy notice, `/videos/[id]`, `/admin/resources`, `/admin/youtube-status`, `Collection`, `ReviewNote`, account and data deletion |
| D6 | YouTube statistics are built but off by default until the compliance audit confirms them |
| D7 | Hosting stays provider-neutral until a target is chosen |
| D8 | Use `main` with one commit per passed phase. The owner is directing progress phase by phase, and no commit has been approved yet. |

### Proposed, awaiting approval

These are implementation details not in the approved plan. None changes the architecture.

| Item | In place now | Reason |
|---|---|---|
| ESLint version | 9.39.5 rather than 10 | Three plugins in `eslint-config-next` don't accept ESLint 10. npm marks 9.39.5 as past end of support. Development only. |
| Local database | `mongodb-memory-server` for tests and local development | This machine had no Docker or `mongod`. It's a real replica set, but `npm ci` downloads about 800 MB. |
| Soft-delete field | Required `isArchived` boolean alongside `archivedAt` | Filtering on a missing optional field is unreliable with Prisma on MongoDB |
| Viewing progress key | Required `scopeKey` (`video` or `playlist:<id>`) | A unique index can't rely on a nullable `playlistId` |
| Module format | `"type": "module"` in `package.json` | Scripts use top-level `await` |
| Bootstrap guard | A permanent `system.superAdminBootstrap` setting | Stops simultaneous or repeat runs. Recovering a lost super admin needs a deliberate manual database change. |
| Server exit on bad config | `process.exit(1)` at startup | Next.js otherwise keeps running and returns 500 to everything |
| `AGENTS.md` | Left in place | `next dev` generates it and re-adds it if removed |
| Muted colour | `#8791A1`, not the specification's `#707A89` | The original is about 4.2:1 on `--surface`, below the 4.5:1 AA minimum. §4.3 calls these starting tokens. |
| Disabled navigation | Unbuilt destinations are dimmed until their phase | §1.5 allows disabling or omitting them. Dimming shows the final structure, so 4 of 5 items look inactive for now. |
| Extra UI packages | `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `@axe-core/playwright` | Required by shadcn/ui, plus the accessibility tests the plan calls for |
| `/design-system` page and `docs/DESIGN_SYSTEM.md` | Development-only page, returning 404 in production | Provides the Quranic text specimen the plan requires, and a reference for later phases |
| Larger controls | Default button and input height 44px, not shadcn's 32px | A touch-first product needs touch-sized targets |
| Screenshots | Saved for review, not compared pixel by pixel | Baselines differ across machines and would fail without real changes |
| Role authority | Only the super admin manages roles, grants, and deactivation. Admins can view users. | §19.5 lists these as super admin powers. This is the stricter reading of "most administrative operations". |
| Editors and publishing | Editors can't publish without an individual grant | The plan's section 10 says so, though §19.4 doesn't state it directly |
| One super admin | Nobody can be promoted to super admin in the application, and that account can't be changed | Prevents lockout and takeover. A second one would need a manual database change. |
| Google data | Tokens aren't stored, and only name, email, and image are copied | Google is used only for sign-in, so stored tokens would add risk and no function |
| Slim phone top bar | 52px, holding the account menu | Phones had nowhere for it, since the bottom bar holds the five destinations. It takes space from the player. |
| Interest prompt | A swipeable slide at the start of the feed | Satisfies "optional" and "don't block", and can't end up in front of the player |
| Comments in the feed | A link to the video's page, not a panel | Any panel opening over the feed would risk covering the player |
| `/videos/[id]` for Shorts too | Same page for both kinds | Gives Shorts a place for comments |
| Publishing requirements | A person must have reviewed a video, and a Short needs a category | Enforces §7.2, and a Short with no category could never appear in the feed |
| Withdrawing data | Past 30 days, YouTube's fields are blanked and the record kept | Meets the policy, keeps links intact, and a later refresh restores it |
| Search normalisation | Built now, ahead of Phase 8 | Topics store search text from the moment they're created |
| Extra packages | `next-auth`, `@next-auth/prisma-adapter`, shadcn dropdown menu | In the approved plan, or needed for the account menu |
| Browser tests against a production build | `E2E_SERVER=production` | The dev compiler ran this machine out of memory. It's also the more faithful test. |
| No `sanitize-html` | Listed in the plan but not installed | Article bodies are never HTML, and the renderer builds React elements, so it would protect nothing |
| No `@hookform/resolvers` | A small resolver in `lib/validation` | About 15 lines replace a dependency |
| Link manager | Topics and libraries save links one at a time, immediately | A topic can hold thousands of videos, which a form can't carry, and editors can't overwrite each other |
| Featured library items | `isFeatured` added to `ArticleLibrary` and `VideoLibrary` | §14 asks for featured content, and the plan's schema had nowhere to hold it |
| Published addresses are locked | A slug can't change until unpublished | Published links may already be shared |
| Who edits what | `content.editAssigned` covers drafts the person wrote or was assigned, and stops at publishing | §19.4 says "assigned drafts" |
| External resources | Managed with `relationships.manage`, so editors and above | The plan names no specific permission |
| Uploads | Stored in `.data/uploads` and served by `/media`, not `public/uploads` | Next.js only serves `public` files that existed at build time |
| Images enter only by upload | No pasting an image address into the editor | Avoids loading third-party images on readers' devices |
| Deleting a parent | Sub-topics and sub-libraries move to the top level | Safer than deleting them with it |
| Review notes | Built now, on the article screen | §19.4 feedback needs them, though the plan's Phase 5 list doesn't name them |
| Related playlists | Those sharing a topic | Needs no extra data, and it's transparent. The plan's schema has no playlist relation. |
| YouTube playlists show unpublished videos | Only on that playlist's page | YouTube's own player would show them anyway. They stay out of the feed and other pages. |
| 500-item limit on playlists | Curated and YouTube | Keeps a page's list and one sync's quota within a known size |
| Long videos resume on their own page | Added with playlists | L7 lists it as reliable. Shorts don't, since nobody resumes a clip. |
| Importer steps | Server Actions, not `api/admin/import` routes as the plan's file list shows | The same as every other dashboard write, with the same checks |
| `/c/` channel addresses | Asks for the `@handle`, with no search call | The plan allowed either. Search costs 100 units, and YouTube says to avoid it for this. |
| Statistics switch | Not on the settings screen | Stays off until the audit (D6), so nobody can turn it on by accident |
| Video deletion | Archive only | Stops a later import bringing back a rejected video |
| Quota limit shown | 10,000, YouTube's default | YouTube's API doesn't report your real limit. It's labelled as an estimate. |
| Server Actions body limit | 3 MB | Long articles exceed the 1 MB default. Services still apply their own limit. |

## Completed work

Phase 7:

- All 14 dashboard sections, each behind its own permission
- YouTube Channel Importer: the 12-step workflow, all six filters, batching, resuming, cancelling, and a result report
- Sync Channel, which finds what's new for review, and runs only when asked
- Video management: filters, review, CTA by search, topics and libraries, and bulk category, topic, kind, and publish
- Bulk assignment on articles
- Categories, users and roles, the audit log, settings, and YouTube status screens
- An overview of real counts and recent activity
- Channels included in the 30-day refresh
- `docs/ADMIN_GUIDE.md` and `docs/YOUTUBE_INTEGRATION.md`

Phase 6:

- YouTube playlist import, sync, and inclusion in the 30-day refresh, with withdrawal and restoring
- Curated playlists with drag-and-drop reordering by mouse, touch, and keyboard, plus arrows and item notes
- The playlist page: one player, items in any order, no auto-skip, attribution on each item, and related content
- Progress and resume for signed-in people, including long videos on their own page
- Playlists on topic, library, and article pages, and CTAs that lead to them
- Dashboard screens for both kinds of playlist
- Tests can no longer reach live credentials, whatever `.env` holds

Phase 5:

- Allow-listed Tiptap JSON with a React renderer, and no stored HTML
- Tiptap editor in RTL: heading levels, lists, quotes, links, images with captions, footnotes, preview, draft saving, and publishing
- Article page: contents, reading progress, sources, footnotes, dates, save, share, and related content
- Searchable pickers and optional relationships on the article form
- Review notes that never affect publishing, and assignment of contributors
- Topic pages, library pages, external resource pages, and their lists
- Link manager for topics and libraries, with featured items
- A related Short opens in a modal over the page, with the feed when opened directly
- Image uploads with validation and re-encoding, and local and S3 storage adapters
- Dashboard screens for articles, topics, libraries, and resources, with permission-aware navigation
- Deleting that leaves no references, and confirmation before removing anything
- CTAs to articles and topics, and related articles on video pages
- `docs/OWNER_ACTIONS.md`, the single list of what the owner must do

Phase 4:

- `lib/youtube`: ID parsing, validated requests, quota tracking per Pacific day, retries for temporary failures only, comments
- Video import as drafts, the 30-day refresh and withdrawal job, a protected cron endpoint, and an admin trigger with status
- The feed: scored allocation with an exploration share, per-category cursors, For You and category tabs, and empty, end, and error states
- The player manager: one player, muted autoplay, pausing, end-of-video and error handling, and a switchable strategy
- Card with attribution, CTA, save, share, sound, and keyboard and button navigation
- `/shorts/[id]`, `/videos/[id]`, and read-only comments
- Watch signals, in the account or the browser, moved into the account at sign-in
- Publishing and assignment services, whose screens arrive in Phase 7
- A development-only import command

Phase 3:

- Optional Google sign-in with database sessions, and an account menu
- The permission matrix for all roles, with individual grants, enforced in services
- Guarded dashboard shell, overview with real counts, and a refusal page
- Append-only audit logger, written in the same transaction as each change
- Rate limiter on MongoDB, and same-origin checks on writes
- Category and topic services, with the 12 starting categories as a safe-to-repeat seed
- Interests for guests and accounts, the skippable first-visit prompt, `/interests`, and merging at sign-in
- Pure scoring functions with stored, validated settings
- Role, grant, and deactivation services, whose screens arrive in Phase 7

Phase 2:

- Design tokens on the specification's palette, dark-only
- IBM Plex Sans Arabic, self-hosted through `next/font`
- shadcn/ui in RTL mode: button, input, card, badge, skeleton, separator, direction
- App shell: bottom bar on phones, compact rail on the right from 768px, skip link, safe-area support
- Navigation with the five destinations, and a rule that unbuilt ones can't appear as links
- Empty, error, not-found, and loading states, with a real retry
- Article typography, and Quranic and mixed-direction text handling
- Central Arabic strings, now also used by server error messages
- The brand mark and favicon
- `docs/DESIGN_SYSTEM.md`

Phase 1, finished within the open phase:

- Project setup with exact version pins, and TypeScript, ESLint, Vitest, and Playwright configuration
- The full Prisma schema: 40 models including join models, covering every domain in the plan
- Text and TTL index script, and the `db:sync` workflow
- Environment validation with exit on failure, plus `.env.example`
- Prisma client singleton, safe error conventions, and redacting structured logger
- Local replica-set script, with data confirmed to survive a restart
- First-super-admin bootstrap command
- Temporary spike page, its browser checks, and the embed-dimensions script
- `README.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`

## Test results

Run on 2026-11-04 on Node 24.19, against MongoDB 8.2.6. This machine can't run the dev compiler with parallel browsers, so browser tests ran against a production build with one worker, and the development-only pages separately.

| Check | Command | Result |
|---|---|---|
| Schema | `prisma validate` | Pass |
| Types | `tsc --noEmit` | Pass |
| Lint | `eslint . --max-warnings=0` | Pass, no warnings |
| Unit | `vitest --project unit` | 424 passed |
| Integration | `vitest --project integration` | 390 passed, on a real replica set, with YouTube mocked |
| Build | `next build` | Pass. The home page stays static. |
| Browser, production build | `E2E_SERVER=production playwright test --workers=1 --timeout=90000` | **409 passed and 12 failed in the full run.** All 12 were two older tests expecting the old `/admin` page. They were updated and passed on a rerun, along with the sound tests, 36 in all. **So no single run shows every test passing.** 17 skipped: the opt-in spike and real-player checks. |
| Browser, development pages | `playwright test tests/e2e/shell.spec.ts --grep ...` | 14 passed |
| Real YouTube player | `REAL_PLAYER_E2E=1 playwright test tests/e2e/real-player.spec.ts` | 6 passed, in emulated Chromium, with no API key or quota |
| Real YouTube API | One-off check on a throwaway database | Passed: importing, a missing ID, comments, refreshing, importing a playlist, a repeat sync, and a missing playlist. 9 quota units. Statistics stayed off. |
| Client bundle | Manual scan | No secret names |
| Spec unchanged | `git hash-object` | Same hash as at the start of the project |

**Intermittent failures, which didn't reproduce on repeat.** They need watching, since passing on retry isn't the same as understood:

- **`feed.spec.ts`, "first-visit prompt is one slide" (mobile):** a player was present when none was expected, once, in an earlier round. It has passed since. **Not explained.** If it recurs on real phones, it would mean a player starting behind the first-visit prompt.
- **Development pages:** a few timed out while the dev server compiled, in earlier runs. All passed in the final run.
- **Google redirect test:** failed once in an earlier round. It needs internet access.

**Slow tests, now explained:** "sends at most 50 IDs" had failed once with no recorded cause. It was a timeout, because importing wrote each video and looked up its channel one at a time, on a nearly full disk. The channel lookup is now remembered within an import, and the limit raised.

**Real bugs these tests found in Phases 5 to 7, all fixed:**

- Saving an article lost all formatting attributes, because Server Actions silently replace the prototype-less objects ProseMirror builds.
- Libraries created without a parent never appeared in the list, because `null` and a missing field differ in MongoDB filters.
- Clicking a toolbar button could drop bold when typing right after it.
- Text just linked could be overwritten by the next key typed.
- Importing looked up the same channel for every video.
- A quick second tap on the sound button could do the wrong thing, because the player reports its state late.
- A filled `.env` could have reached automated tests. They now blank any live credentials.

**Not tested:** real phones, Safari and Firefox (browser tests run only on Chromium), the importer against a real channel, a large real playlist, real Google sign-in, a real S3-compatible provider, MongoDB Atlas, the TTL indexes actually removing data, and deployment on a host. `npm ci` wasn't re-run after this round's new packages.

## Known issues

### Temporary code

- **Spike code** must be deleted once its results are recorded: `src/app/spike/`, `tests/e2e/spike-feed.spec.ts`, and `scripts/youtube/spike-embed-dimensions.ts`. The page is unavailable in production builds.

### Known issue: YouTube's icon on the feed

The feed keeps its thumbnail and loader up until the video's time moves, then shows nothing of ours on top. YouTube then draws its own pause icon in the middle of the player. Measured on the real player in emulated Chromium on 2026-11-05, it stays for about 3.5 to 5 seconds after the video starts. Adding `fs=0`, `disablekb=1`, and `rel=0` made no visible difference, though that run didn't confirm they reached the player. It still needs checking on real phones, and the owner needs to decide whether to accept it.

### Placeholders needing a decision

- **Product name:** ميم, in `src/config/strings.ar.ts`.
- **Logo:** `public/logo.png`, used by `BrandMark`. `src/app/icon.png` and `src/app/apple-icon.png` are made from it, so regenerate them if it changes.

### Quranic text

The Al-Fatiha sample rendered legibly, with its marks intact, in IBM Plex Sans Arabic. Plex is a general text font, and this was a visual check only. **Someone qualified should review Quranic rendering before launch.** A dedicated font for quotations remains possible if needed.

### Security audit findings

`npm audit` reports 11 (3 high, 8 moderate) in the latest run, down from 19. No package was force-fixed, so the moderate count fell from changes in npm's advisories or dependency versions, and that wasn't investigated. None was force-fixed, because npm's suggested fixes would break the stack.

- **3 high:** one chain, `prisma` → `@prisma/config` → `deepmerge-ts` (stack exhaustion on recursive objects). The only fix npm offers is Prisma 7, which doesn't support MongoDB. It appears to affect Prisma's configuration tooling, which doesn't handle untrusted input here, but this was judged from the dependency chain and not confirmed by reading the code. Recheck on each Prisma update.
- **16 moderate:** all in ESLint tooling, through `minimatch`. Development only. npm's suggested fix would downgrade ESLint and `eslint-config-next` to very old versions.

### Warnings to expect

- **VS Code shows an error on `schema.prisma` line 19** ("`url` is no longer supported"). This is a false alarm: the Prisma extension applies Prisma 7 rules, while the pinned 6.19.3 CLI validates the schema. The extension may offer a setting to stay on Prisma 6 rules, which would silence it.
- **`npm ci` prints an `allow-scripts` warning** for some packages, and a deprecation notice for ESLint. Install scripts still ran, and the install worked.
- **`prisma validate` needs `DATABASE_URL`**, so `npm run verify` needs a `.env` file first.
- **`next build` needs internet access**, to download the font.
- **Saved videos have nowhere to appear yet.** Saving works and persists, but `/saved` arrives in Phase 8.
- **A malformed address on a page with a dynamic segment, such as `/topics/%E0%A4%A`, returns 500.** Next.js rejects it before application code runs, with a plain message and no details. A browser test confirms nothing is revealed. Revisit in Phase 9.
- **Images removed from an article stay in storage.** It's harmless, but unused files accumulate.
- **`next start` logs a `url.parse()` deprecation warning**, from a dependency.
- **`db:sync` drops search and TTL indexes briefly**, and took about 110 seconds here. Run it in a quiet period on production.
- **`shadcn add` adds an unwanted `cn` package and import** each time. `docs/DESIGN_SYSTEM.md` explains how to undo both.
- **Dev server warning during browser tests:** a hydration mismatch on `caret-color`, caused by Playwright's screenshot tool hiding the input caret. Not a bug in the application.

### Documentation location

Specification §1.4 and §31 place `PROJECT_STATUS.md` in the repository root. It is in `docs/` at the owner's request. The other documents in §31 arrive in later phases, as the plan schedules them.

### Local machine

**C: is low, at about 3.4 GB free, and D: has about 84 GB after the owner cleared space. Memory is also tight.** Tests stayed slow even after D: was cleared: the integration suite took 26 minutes, against about 3 minutes earlier. The cause isn't established. Test databases are cleared from `D:\Work\.muslim-tooling\tmp` after runs.

### Open project risks

- **YouTube policy (R1):** whether a multi-channel feed is allowed is unresolved. It needs the API Compliance Audit before public launch.
- **Privacy consent (R3):** whether a non-blocking notice satisfies YouTube's "agree to a privacy policy" requirement is a question for the audit.
- **Statistics (R2):** whether storing them is allowed needs confirming.
- **Prisma:** version 6 is required for MongoDB, and the long-term path depends on Prisma's plans.

## Pending tasks

### Owner actions

The complete list, with steps, is in [OWNER_ACTIONS.md](OWNER_ACTIONS.md).

### Then, to close Phase 1

- [ ] Record the device results and choose the player strategy
- [ ] Confirm D2's final layout
- [ ] Delete the spike code, and re-run all gates
- [ ] Commit on `main`
