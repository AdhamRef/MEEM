# YouTube integration

How the platform uses YouTube, and what must stay true. For the code conventions, see [ARCHITECTURE.md](ARCHITECTURE.md). The policy risks are R1 to R8 in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Rules

| Rule | Where it's enforced |
|---|---|
| `lib/youtube` is the only caller of the Data API | Code convention, and a test that feed rendering makes no such request |
| No OAuth scopes. An API key only. | `lib/auth` requests `openid email profile` |
| Stored data is refreshed or removed within 30 days | `features/youtube/metadata-refresh.service.ts` |
| Titles and descriptions are never edited | Services accept no such field for YouTube content |
| Publishing | **Content from followed sources is published automatically** (owner's decision, plan D10). Admins hide or reclassify it afterwards. Anything else stays a draft until a person publishes it. |
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

## Content sources

By the owner's decision of 2026-11-07 (plan D10), admins follow sources on `/admin/sources`, and new content is published automatically. This replaced the 12-step importer and its review queue. Its old `ImportJob` and `ImportCandidate` records stay in the database, and the TTL index still removes the previews.

One box takes any of these, worked out by `features/youtube/sources/detect.ts`, so only validated IDs reach YouTube:

| Pasted | What happens |
|---|---|
| A channel address, `@handle`, or `UC…` ID | Followed. Its videos arrive through checks, below. |
| A playlist address or ID | Imported as a YouTube playlist and published, with its videos published. |
| One or more video links | Published at once. Their channel is saved but not followed. |

**A check** (`checkChannel` in `channel-check.service.ts`) reads the uploads playlist, newest first, until a page holds a video already stored, so finding new uploads usually costs 1 unit. Details are fetched only for IDs not stored, in one batched request per page. Until every older upload has been read, the walk carries on from `backfillPageToken`, saved after each page, so an interrupted check loses nothing. A video already stored is never touched, which is how a hidden video stays hidden.

| Requirement | How it's met |
|---|---|
| No duplicates | The unique index on `youtubeVideoId` decides. A clash during `createMany` falls back to one-by-one inserts. |
| One check per channel at a time | A lease, `checkLockedUntil`, taken with a conditional update and released at the end. A lease left by a crashed check expires within 30 seconds of its deadline. |
| Bounded run time | No new page starts after the deadline: 20 seconds for a person's check, 45 for the hourly job. At least one page is read, so every check progresses. |
| Quota | The hourly job stops once the day's usage reaches `autoCheckQuotaCeiling`, 8,000 by default. `quotaExceeded` is never retried. |
| Switchable | `autoCheckEnabled` in the settings stops the hourly job without changing anything stored. |

**A channel’s playlists** come next, once its uploads have all been read, so the videos in them are mostly stored already. `walkChannelPlaylists` reads the channel’s list with `playlists.list?channelId=`, 1 unit per 50, saving its place after each page. Each playlist not yet stored is created with `sourceChannelId`, synced, and published once it has items. Empty lists are skipped. The list is read again daily for new playlists, and playlists found this way are re-synced daily, while a playlist added on its own is re-synced hourly. Channels added with the old importer and never followed get their playlists too, without their uploads being walked. A playlist someone unpublished stays unpublished.

**While a Sources or channel page is open**, the browser asks for one 20-second step after another for channels still on their first fetch, so a new channel fills in minutes. With the page closed, the hourly job continues from the same place.

**The hourly job** is `/api/cron/sources-check`, protected by `CRON_SECRET` like the refresh. It checks followed channels not checked in the last 55 minutes, or still on their first fetch, oldest first, then syncs YouTube playlists not synced in that time. Each run leaves an audit record from `system:cron`, and the Sources page shows the last one. `.github/workflows/youtube-schedule.yml` calls it every hour, and calls the daily refresh once a day.

## Detecting Shorts

The API has no field saying a video is a Short. Length gives a suggestion only, using the configurable threshold, 180 seconds by default. Choosing a kind, or pressing publish, sets `reviewedAt`. Videos published automatically from sources keep the suggested kind and no `reviewedAt`. The owner decided on 2026-11-05 that publishing shouldn't require choosing a kind or category first, so bulk publishing can publish candidates as they stand, and a kind can be wrong until corrected.

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

- **Likes, views, and comment counts** come with the same `videos.list` request the importer and the refresh job already make, so they cost no extra quota. They're stored and shown as they are, never fetched live, in the feed, on Explore, and on video pages. The refresh job updates them within YouTube's 30-day limit as part of its normal run. Statistics are on by the owner's decision of 2026-11-06. Nothing can be liked from this site, as that would need YouTube sign-in scopes, which this project doesn't request.
- **Videos stored before this** get theirs from `npm run youtube:backfill-stats`, or the button on the admin's YouTube status page. It costs 1 quota unit per 50 videos and only reads what's missing, so it can be run again.
- **Comment text** costs quota on each load, so it stays on the video page, read-only and fetched when opened. It isn't shown on Explore or in the feed.

## The player

**The home feed differs from the rest of this section, by the owner's decisions of 2026-11-05 and 2026-11-06.** See [YOUTUBE_COMPLIANCE_AUDIT.md](YOUTUBE_COMPLIANCE_AUDIT.md). This is what it does while those settings are on:

- **Buffering.** Real players sit on the next 4 cards (3 on devices reporting 4 GB of memory or less, 1 with data saver on). YouTube fetches nothing until a video plays, so a player that's merely prepared gains nothing: in an earlier measurement it started in 1.1 to 3.2 seconds, against 0.9 to 1.4 for loading into the existing player. So each plays muted until its first frame, then rewinds and pauses. Measured on the real player, that starts a video in about 0.29 seconds, against 1.04 to 1.77 when it loads on arrival. Those figures are from one desktop machine, on emulated Chromium.
- **Swiping.** A card starts as soon as 5% of it is visible, and a buffered card's thumbnail goes the moment YouTube reports it playing, with no fade. Measured on the real player, the thumbnail left at 451 ms after a key press, and the card settled at 525 ms, so the video is already running when the swipe ends. Before these changes it left at 614 to 752 ms. YouTube's reaction to `playVideo` is about 0.28 seconds, and can't be shortened from here.
- **The card being left** keeps running, muted, for up to 0.6 seconds as it slides out, rather than turning back into its thumbnail. Coming back within that time carries on where it was.
- **Why a buffered card isn't simply shown instead of its thumbnail.** A paused YouTube player shows a dimmed picture with a large play icon, which looks worse. YouTube also shows its own pause icon over a video for a few seconds after it starts, which can't be hidden and which fades by itself.
- **Fast swipes.** A card with no buffered player shows its thumbnail, which drifts slowly. The spinner stays out of sight for the first 1.2 seconds.
- **Sound.** On by default, and a person's mute is remembered in the browser. **No browser allows sound before a person has touched the page**, which was measured on the real player: playing unmuted fires `onAutoplayBlocked` and doesn't start, and unmuting a running video pauses it. So the first video starts at once and silently where it has to, with a small "tap for sound" hint, and the first touch brings sound, for that video and every one after. There's no start button, by the owner's decision of 2026-11-06. Browsers don't count a scroll as permission, so until sound is allowed the feed moves with the finger itself, which makes a first swipe count too, and normal scrolling returns straight after. A mouse wheel can't count, so on a computer it takes a click or a key. Someone who chose to mute stays muted. If a browser still refuses, the video goes back to muted rather than stopping. Whether sound carries from one player to another on real phones, above all iPhones, **hasn't been tested**.

**Video pages**, under the same switch, crop YouTube's interface away and use our own controls: play, seek, sound, and fullscreen where the browser offers it, through documented player methods. The player stays at the top while scrolling, and starts by itself, with sound if the person arrived by a click.

Everywhere else, including playlist pages:

- One player per page, created only when needed.
- Other pages wait for a click.
- Nothing is ever placed in front of the player. **The feed uses YouTube's documented `controls=0` setting** (the owner's decision of 2026-11-05, for a cleaner vertical view), so its control bar doesn't show there. Sound and next are outside the player, and tapping a video pauses it, which YouTube handles. Video and playlist pages keep the controls. The end screen is left alone. A video ending stays on the end screen, with "next" offered outside.
- It pauses when hidden, and nothing plays in the background.
- `Referrer-Policy: strict-origin-when-cross-origin` is set globally, because the player fails with error 153 without a referrer.

## Testing

Automated tests never use a real key. YouTube is mocked at the network layer, and the Vitest and Playwright configurations blank any credentials found in `.env`. `tests/e2e/real-player.spec.ts` uses the real player, with no key or quota, when `REAL_PLAYER_E2E=1` is set.
