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

## Likes and comments

- **Likes and views** are read from what the regular metadata refresh stored, so showing them costs no quota. They appear on video pages and Explore only when `statisticsEnabled` is on, which stays off until the API Compliance Audit confirms it's allowed. Nothing can be liked from this site, as that would need YouTube sign-in scopes, which this project doesn't request.
- **Comments** cost quota on each load, so they stay on the video page, read-only and fetched when opened. They aren't shown on Explore or in the feed.

## The player

**The home feed differs from the rest of this section, by the owner's decisions of 2026-11-05 and 2026-11-06.** See [YOUTUBE_COMPLIANCE_AUDIT.md](YOUTUBE_COMPLIANCE_AUDIT.md). This is what it does while those settings are on:

- **Buffering.** Real players sit on the next 4 cards (3 on devices reporting 4 GB of memory or less, 1 with data saver on). YouTube fetches nothing until a video plays, so a player that's merely prepared gains nothing: in an earlier measurement it started in 1.1 to 3.2 seconds, against 0.9 to 1.4 for loading into the existing player. So each plays muted until its first frame, then rewinds and pauses. Measured on the real player, that starts a video in about 0.29 seconds, against 1.04 to 1.77 when it loads on arrival. Those figures are from one desktop machine, on emulated Chromium.
- **Swiping.** A card starts as soon as 5% of it is visible, and a buffered card's thumbnail goes the moment YouTube reports it playing, with no fade. Measured on the real player, the thumbnail left at 451 ms after a key press, and the card settled at 525 ms, so the video is already running when the swipe ends. Before these changes it left at 614 to 752 ms. YouTube's reaction to `playVideo` is about 0.28 seconds, and can't be shortened from here.
- **The card being left** keeps running, muted, for up to 0.6 seconds as it slides out, rather than turning back into its thumbnail. Coming back within that time carries on where it was.
- **Why a buffered card isn't simply shown instead of its thumbnail.** A paused YouTube player shows a dimmed picture with a large play icon, which looks worse. YouTube also shows its own pause icon over a video for a few seconds after it starts, which can't be hidden and which fades by itself.
- **Fast swipes.** A card with no buffered player shows its thumbnail, which drifts slowly. The spinner stays out of sight for the first 1.2 seconds.
- **Sound.** On by default, and a person's mute is remembered in the browser. **No browser allows sound before a person has touched the page**, which was measured on the real player: playing unmuted fires `onAutoplayBlocked` and doesn't start, and unmuting a running video pauses it. So where a browser would refuse, the feed opens on a one-tap welcome screen (`SoundGate`, the owner's decision of 2026-11-06). The first video runs muted behind it, and the tap returns it to the start with sound, and every video after that has sound. Someone who chose to mute isn't asked, and if a browser allows sound anyway, the screen goes by itself. If a browser still refuses, the video goes back to muted with a "tap for sound" hint rather than stopping. Whether sound carries from one player to another on real phones, above all iPhones, **hasn't been tested**.

Everywhere else:

- One player per page, created only when needed.
- Autoplay starts muted. Other pages wait for a click.
- Nothing is ever placed in front of the player. **The feed uses YouTube's documented `controls=0` setting** (the owner's decision of 2026-11-05, for a cleaner vertical view), so its control bar doesn't show there. Sound and next are outside the player, and tapping a video pauses it, which YouTube handles. Video and playlist pages keep the controls. The end screen is left alone. A video ending stays on the end screen, with "next" offered outside.
- It pauses when hidden, and nothing plays in the background.
- `Referrer-Policy: strict-origin-when-cross-origin` is set globally, because the player fails with error 153 without a referrer.

## Testing

Automated tests never use a real key. YouTube is mocked at the network layer, and the Vitest and Playwright configurations blank any credentials found in `.env`. `tests/e2e/real-player.spec.ts` uses the real player, with no key or quota, when `REAL_PLAYER_E2E=1` is set.
