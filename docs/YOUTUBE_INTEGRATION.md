# YouTube integration

How the platform uses YouTube, and what must stay true. For the code conventions, see [ARCHITECTURE.md](ARCHITECTURE.md). The policy risks are R1 to R8 in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Rules

| Rule | Where it's enforced |
|---|---|
| `lib/youtube` is the only caller of the Data API | Code convention, and a test that feed rendering makes no such request |
| No OAuth scopes. An API key only. | `lib/auth` requests `openid email profile` |
| Stored data is refreshed or removed within 30 days | `features/youtube/metadata-refresh.service.ts` |
| Titles and descriptions are never edited | Services accept no such field for YouTube content |
| Nothing is published automatically | Imports and syncs create drafts. A person pressing publish, one at a time or in bulk, counts as the review. |
| Statistics are off | The settings screen can't turn them on, until the API Compliance Audit confirms them |
| Comments are read-only, and not stored | `features/youtube/comments.service.ts` |
| Every item showing YouTube's content credits it | Cards, search results, suggestions, saved items, and history (R4) |
| On-site figures are labelled as not from YouTube | "Popular" on Explore says so (R6) |

## API calls and quota

The default allowance is 10,000 units per day, resetting at midnight Pacific time. Use is estimated per day in `ApiQuotaUsage`, and shown on `/admin/youtube-status`.

| Operation | Endpoint | Units |
|---|---|---|
| Find a channel | `channels.list` | 1 |
| A page of uploads, or playlist items (50) | `playlistItems.list` | 1 |
| Video details (50) | `videos.list` | 1 |
| Playlist details | `playlists.list` | 1 |
| A page of comments | `commentThreads.list` | 1 |

A channel of 10,000 videos costs about 400 units to preview, and nothing more to import, because importing uses the preview's data.

**`search.list` is never used.** It costs 100 units, and uploads are read from the uploads playlist instead. That's why `/c/` addresses aren't supported (limit L8): the API has no direct lookup for them, so people are asked for the `@handle`.

**`quotaExceeded` is never retried.** It marks the day as exhausted, and no further calls are made until the reset. Only temporary failures are retried.

## The importer

A job on the server, advanced by the browser one step at a time. There's no queue, so unfinished jobs run only while the importer list or that job's page is open. The list runs them one after another, oldest first, and closing it loses nothing.

```text
startChannelImport → resolves the channel, creates the job (DISCOVERING)
runDiscoveryStep   → one page of uploads and their details, repeated until done (READY_FOR_REVIEW)
                     the page token is saved each time, so it can resume
                     quota or API failure → PAUSED, with the reason
review             → filter, select, assign
runImportStep      → 25 videos per call (IMPORTING), then COMPLETED with a report
```

| Requirement | How it's met |
|---|---|
| Closing the browser loses nothing | Everything is stored after each step, and reopening continues |
| No duplicates | The unique index on `youtubeVideoId` decides. A clash counts as "duplicate" and isn't an error. |
| Previews respect the 30-day limit | `ImportCandidate.expiresAt` is 29 days out, and a TTL index removes them |
| The 30-day clock stays honest | An imported video's `metadataFetchedAt` is when the preview was fetched |
| Stopping | Takes effect at once, whether or not a page is working on the job. A step already under way can't bring it back. What's imported stays, as drafts. |
| Deleting | Removes the job and its preview list, in any state. Imported videos stay, and the audit log keeps a record. |
| One job per channel | Starting a channel with an unfinished job continues that job, so quota isn't spent twice on the same videos. |
| Honest status | "Running" appears only while a step is under way, or when the server saved progress in the last minute. |

**Sync** uses the same job with type `SYNC`. It only fetches details for videos not yet stored, and stops at the first page with nothing new, because uploads run newest first. It runs only when someone presses the button, so there's no background polling (§7.4).

## Detecting Shorts

The API has no field saying a video is a Short. Length gives a *candidate* only, using the configurable threshold, 180 seconds by default. Choosing a kind, or pressing publish, sets `reviewedAt`. The owner decided on 2026-11-05 that publishing shouldn't require choosing a kind or category first, so bulk publishing can publish candidates as they stand, and a kind can be wrong until corrected.

**Shape comes from `player.embedWidth` and `embedHeight`,** which YouTube reports when `maxHeight` is sent, at no extra quota. Tested on 50 of the owner's real videos: vertical ones report 608×1080 and wide ones 1920×1080, including wide clips under 3 minutes. A wide video is never a Short candidate, and the feed sizes each player to its real shape. It's stored data, refreshed with everything else. `npm run youtube:backfill-shapes` fills it in for videos and previews stored before this existed.

## The daily refresh

**Production must call this daily.** Without it, videos leave the site after 30 days.

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-site/api/cron/youtube-refresh
```

Each run works oldest first, within set limits so quota use stays predictable:

| Stored data | Per run | If YouTube no longer has it |
|---|---|---|
| Videos | 20 batches of 50, configurable | Its fields are cleared, and it leaves public pages |
| Playlists | 10 | Same, and its items are removed |
| Channels | 50 | Same, and it's marked inactive |

Anything past 30 days with nothing fresher is withdrawn the same way, even when the API is off or out of quota. Records and their links stay, so a later refresh restores them.

## The player

**Preloading.** The next 5 thumbnails and the next page of videos load ahead. Players don't. On the real player, a video loaded into the existing player started in 0.9 to 1.4 seconds, and a player prepared ahead of time in 1.1 to 3.2 seconds, because YouTube downloads nothing until playback starts. Each prepared player is also a whole iframe, and on phones may not share the person's sound permission. Those figures are from one desktop machine.

- One player per page, created only when needed. "Preload" means the next thumbnail and YouTube's script.
- Autoplay starts muted, and only in the feed. Other pages wait for a click.
- Nothing is ever placed in front of the player. **The feed uses YouTube's documented `controls=0` setting** (the owner's decision of 2026-11-05, for a cleaner vertical view), so its control bar doesn't show there. Sound and next are outside the player, and tapping a video pauses it, which YouTube handles. Video and playlist pages keep the controls. The end screen is left alone. A video ending stays on the end screen, with "next" offered outside.
- It pauses when hidden, and nothing plays in the background.
- `Referrer-Policy: strict-origin-when-cross-origin` is set globally, because the player fails with error 153 without a referrer.

## Testing

Automated tests never use a real key. YouTube is mocked at the network layer, and the Vitest and Playwright configurations blank any credentials found in `.env`. `tests/e2e/real-player.spec.ts` uses the real player, with no key or quota, when `REAL_PLAYER_E2E=1` is set.
