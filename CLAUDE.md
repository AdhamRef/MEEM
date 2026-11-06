# Project instructions

An Arabic-first, free Islamic knowledge discovery platform: a vertical Shorts feed, a topic-centred knowledge network, articles, libraries, playlists, and a volunteer admin dashboard with a YouTube channel importer.

## Source documents

Read these before working on the project.

| Document | Role |
|---|---|
| [docs/MASTER_SPECIFICATION.md](docs/MASTER_SPECIFICATION.md) | **Product source of truth. Never edit it.** |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | The approved architecture, schema, phases, decisions (D1–D8), limits (L1–L8), and policy restrictions (R1–R8) |
| [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) | Current state. Read it first and update it as work progresses. |
| [docs/OWNER_ACTIONS.md](docs/OWNER_ACTIONS.md) | Everything only the owner can do. Keep it current as items are finished or new ones appear. |

If the specification and plan conflict, or a requirement seems impossible, stop and ask. Do not remove, simplify, or replace a requirement, or change the approved architecture, without the owner's approval. If an external platform prohibits something, explain the limit, propose the closest compliant alternative, and document the difference (§32).

## How to work

- Follow the phases in the plan, in order. A phase starts only when the owner's latest instructions allow it, and the next begins only after the current one passes its acceptance criteria and quality gates.
- Run nothing beyond what the current instruction allows. If asked for documentation only, do not install packages or change application code.
- Commit or push only with approval.
- Report results faithfully: state what was verified, what wasn't, and why. Compiling is not completion.
- Do not add features, packages, or infrastructure the plan doesn't include. New dependencies need a clear reason.

## Non-negotiable product constraints

- Arabic only in this release, fully RTL, dark-first, mobile-first, and premium in feel. Avoid traditional religious-portal or generic SaaS styling.
- Free: no payments, subscriptions, paywalls, or ads.
- Guests can browse everything without signing in and are never blocked by login prompts. Google sign-in is optional.
- YouTube is the only video provider, played only through official embedding. Never download or re-host videos.
- Recommendations are transparent, category-based scoring with a configurable exploration share. No AI or machine learning, and no inference of a user's beliefs or identity.
- No internal likes, comments, follows, or messaging, and no gamification. Section 29 of the specification lists further deferred features.
- Article publishing is `DRAFT → PUBLISHED`. The scientific reviewer role never adds a mandatory approval stage.
- **No fake functionality.** Every visible control does something real. If a capability is unavailable, disable or omit it and explain why. Never invent statistics, popularity, or results, and never leave critical TODOs or placeholders.

## Architecture rules

- Stack: Next.js App Router, TypeScript, React, MongoDB, Prisma, Tailwind CSS, shadcn/ui, NextAuth, Zod, React Hook Form, Tiptap. **Do not replace any of these.**
- Modular monolith organised by domain (§3.1). No microservices, queues, Redis, or external search engine.
- Server Components by default. Client Components only where the browser is required.
- Only `features/*` services access Prisma, and UI components never query the database.
- `lib/youtube` is the only caller of the YouTube Data API. Feed rendering reads stored data and never calls the API.
- Keep Arabic text in `src/config/strings.ar.ts` and use logical CSS properties only, so localisation stays possible. Do not build i18n now. ESLint rejects physical direction classes.
- Follow [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md). `shadcn add` adds an unwanted `cn` package and import, so undo both each time, as described there.
- When a phase ships a navigation destination, set its `isAvailable` to `true` in `src/config/navigation.ts`.
- This Next.js version differs from older ones, for example `retry` in error boundaries and `proxy.ts`. Check `node_modules/next/dist/docs/` when unsure.

## Pinned versions

Never run an unpinned install or upgrade of these. The plan explains why in section 3.

- **`prisma` and `@prisma/client`: exactly 6.19.3.** Prisma 7 doesn't support MongoDB, and the `latest` tag for `prisma` was a release candidate when checked.
- **`typescript`: 6.0.3.** TypeScript 7 breaks `typescript-eslint`.
- **`next-auth`: 4.x stable**, isolated behind `lib/auth`. v5 is still in beta.

## MongoDB and Prisma rules

- MongoDB must be a replica set, because Prisma uses transactions.
- Apply schema changes with `npm run db:sync`, since Prisma Migrate doesn't support MongoDB. **Never run `prisma db push` alone:** it deletes the script-managed text and TTL indexes, which `db:sync` recreates.
- Never mark an optional field `@unique`: MongoDB treats null and missing as one value. Use a required key instead, such as `Playlist.sourceKey`.
- `createMany` has no `skipDuplicates` on MongoDB. Check existing IDs first and handle `P2002`.
- Null and missing fields differ in filters, so don't rely on optional fields in "active" filters.
- Use explicit join models with compound unique indexes for many-to-many relations.
- Never hard-delete audit logs. Use soft deletion or archival for important editorial content, and leave no broken references.

## YouTube rules (compliance is mandatory)

**One exception, by the owner's informed decisions of 2026-11-05 and 2026-11-06:** the home feed deliberately breaks the player rules below. When `FEED_IMMERSIVE_OVERLAY` in `src/config/feed.ts` is true, our interface and a touch layer sit in front of the player, YouTube's own interface is cropped out of view, a thumbnail covers the player until its first frame, and videos loop past the end screen. When `FEED_BUFFER_AHEAD` is above zero, real players stay buffered on the next cards, each having played muted out of sight until its first frame, and the feed starts with sound whenever the browser allows it. This risks API access and embeds, may trigger hidden ads or count as artificial playback, and won't pass the API Compliance Audit, so both must be turned off, or reviewed with YouTube, before that audit. Everywhere else, these rules still apply. Don't extend the exception.

- **Never place anything in front of the player**, including text, CTAs, buttons, or transparent layers for gestures. Keep it all outside the player.
- Don't hide or alter YouTube branding, ads, or end-of-video related links. Don't imitate player controls. Only documented player parameters may change the player: the feed uses `controls=0` by the owner's decision (2026-11-05), and other pages keep the controls.
- Don't use mouseover or touch events on the player to trigger actions.
- Autoplay starts muted, only when more than half the player is visible. Only one player may auto-play at a time, the viewport is at least 200×200, and nothing plays in the background.
- Instantiate players only for active cards. "Preload next" means thumbnail and API script, not a hidden player.
- Keep `Referrer-Policy: strict-origin-when-cross-origin`, or the player fails with error 153.
- Attribute YouTube as the source on every item that shows its content. Don't alter YouTube titles.
- Stored API data must be refreshed or removed within 30 days, including statistics and import previews, and videos must be checked for deletion every 30 days.
- Statistics stay off by default until the compliance audit confirms they are allowed, and are never used for ranking or fabricated.
- Comments are read-only, labelled as YouTube comments, and not stored. Request no YouTube OAuth scopes.
- Shorts detection produces *candidates* for human review. Don't auto-publish them or use undocumented detection tricks.
- Enumerate channel uploads through the uploads playlist, batch requests, and never retry `quotaExceeded`.
- **The API Compliance Audit (plan item R1) must be addressed before public launch.**

## Coding standards

- TypeScript strict mode. Avoid `any`, and validate all external input with Zod.
- Keep logic in small service functions, and pure functions where possible, so scoring, parsing, and normalisation stay easily tested.
- Throw `AppError` for expected failures. Users never see stack traces or internal messages.
- Every page needs loading, empty, and error states, plus responsive behaviour, focus states, and accessible controls.
- Use Lucide icons, never emoji as interface icons. Avoid unneeded dependencies, nesting, and client JavaScript.
- Paginate on the server with cursors where practical. Never fetch whole collections for a feed or list.
- Comments explain why, not what. Documentation describes only what actually exists.

## Security requirements

- Validate every input on the server and enforce authorization in services. Hiding UI is not authorization, and client-supplied roles are never trusted.
- Check ownership before changing user-specific data.
- Keep secrets server-only and out of logs. Never commit real credentials. Validate configuration at startup without printing values.
- Store rich text as allow-listed Tiptap JSON and sanitise on render. Never store arbitrary HTML, and never use `dangerouslySetInnerHTML` for content.
- Validate external URLs, and resolve YouTube input to valid IDs rather than trusting it.
- Restrict uploads by type and size, use safe file names, and don't store binaries in MongoDB.
- Rate-limit sensitive endpoints. Use secure cookie and session settings with database sessions.
- Audit log every privileged action. An admin can never remove or override the super admin, and the first super admin is created only through the bootstrap procedure.
- Admin and private pages are never indexed. Confirm destructive actions.

## Testing requirements

A phase is not complete until all of these pass and `docs/PROJECT_STATUS.md` is updated:

1. Prisma schema validation
2. TypeScript checks
3. ESLint
4. Unit tests
5. Integration tests against a real MongoDB replica set
6. Production build

Also:

- Test what section 27 of the specification lists, including scoring, parsing, normalisation, permissions, and unauthorized operations.
- Mock YouTube in automated tests; live credentials must not be required. Don't add a test-only login provider to production.
- Add end-to-end tests for each phase's main flows, on mobile and desktop profiles.
- Fix failures rather than ignoring them. Report any test that couldn't run, and why.

## Local environment note

If the C: drive is low on space, set these per command so caches and temp files go to D::

```powershell
$env:npm_config_cache='D:\Work\.muslim-tooling\npm-cache'
$env:TEMP='D:\Work\.muslim-tooling\tmp'; $env:TMP='D:\Work\.muslim-tooling\tmp'
$env:MONGOMS_DOWNLOAD_DIR='D:\Work\.muslim-tooling\mongodb-binaries'
$env:PLAYWRIGHT_BROWSERS_PATH='D:\Work\.muslim-tooling\playwright'
```

This machine runs short of memory, and the dev compiler with parallel browsers crashes it. Run browser tests against a production build with one worker, as the README describes, and run only the development-page tests on the dev server. Stopped test runs leave `mongo-mem-*` folders in the temp directory, several gigabytes in total, which are safe to delete once no `mongod` is running.
