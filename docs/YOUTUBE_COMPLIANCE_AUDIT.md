# YouTube API Compliance Audit: preparation

For whoever submits the audit form, and for YouTube's reviewers if it's useful to share. **This is preparation, not a statement of compliance.** Only YouTube can decide that, and the biggest question below is open. I can't determine it from the published documents.

Submit it through the [API Services audit and quota extension form](https://support.google.com/youtube/contact/yt_api_form). The form's own questions may differ from what's here.

## Known deviation: resolve this first

**The home feed currently breaks YouTube's rules, by the owner's decision of 2026-11-05.** With `FEED_IMMERSIVE_OVERLAY` true, it places interface elements and a touch layer in front of the player, crops the player so YouTube's own interface is out of view, covers it with a thumbnail until the first frame, and loops videos past the end screen. Taps and swipes never reach the player, so anything YouTube shows there, including ad controls, can't be used.

Rules this conflicts with: "You must not display overlays, frames, or other visual elements in front of any part of a YouTube embedded player", "you must not use overlays, frames or other visual elements to obscure any part of an embedded player", and policy I.6, "modify, build upon, or block any portion or functionality of a YouTube player".

**The feed also buffers hidden players, by the owner's decision of 2026-11-06.** With `FEED_BUFFER_AHEAD` above zero, real players sit on the next 3 or 4 cards, off screen. YouTube fetches nothing until a video plays, so each one plays muted until its first frame, then rewinds and pauses. The feed also starts with sound where the browser allows it, rather than always muted. A card starts as soon as 5% of it is visible, and the card being left keeps running muted for up to 0.6 seconds as it slides out, so two players can run at once.

Rules this conflicts with: autoplay only when more than half the player is visible, only one auto-playing player, and playback only as a person's choice. Playing out of sight may also trigger ads nobody sees, or count as artificial playback for the channel. Neither was measured. Priming gives up and pauses after 6 seconds so that nothing keeps running unseen, and hidden plays are never recorded as views or signals on this site, but what YouTube records can't be controlled from here.

**This won't pass an audit as it stands.** Set `FEED_IMMERSIVE_OVERLAY` to false before applying, which also turns buffering off and restores the layout the tables below describe. The tables describe that compliant layout, not the current one.

**Publishing is automatic, by the owner's decision of 2026-11-07 (plan D10).** New videos from followed channels and playlists go live without a person reviewing each one, and a scheduled job checks those sources every hour. The kind, Short or long, is the length-and-shape suggestion until someone changes it. This weakens the "human curation" case below, which now rests on choosing the sources and hiding what doesn't fit. The hourly job's quota use is bounded by a daily ceiling and can be switched off.

**Video pages and statistics also differ, by the owner's decision of 2026-11-06.** Video pages crop YouTube's interface away, put our own controls in front, start by themselves, and stay at the top while scrolling, under the same `FEED_IMMERSIVE_OVERLAY` switch. Statistics are on: likes, views, and comment counts are stored and shown, which the plan's R2 says YouTube limits to audited developers. Set `statisticsEnabled` to false in `DEFAULT_YOUTUBE_SETTINGS` before applying, and remove what's stored.

**Explore also looks much like YouTube's home page, by the owner's decision of 2026-11-06:** a grid of video cards, category chips, and a Shorts row, in this site's own name, logo, and colours. The curation, articles, topics, and libraries are what give it independent value, but the resemblance adds to question 1 below (III.I.1, and the guide's "identical copy of YouTube"). Worth reviewing before the audit. It starts no playback by itself.

## Before submitting

Reviewers usually need to see a working product, so these come first:

- [ ] Deploy the site somewhere reachable, with the legal pages complete
- [ ] Add real, reviewed content
- [ ] Fill in the responsible party, contact, and API project number below

| Field | Value |
|---|---|
| Responsible party | *Owner to provide* |
| Contact | *Owner to provide* |
| Google Cloud project number | *Owner to provide* |
| Site address | *Owner to provide* |

## What the application is

A free, Arabic-language platform for learning about Islam. Volunteer editors choose videos from YouTube channels, and connect them with original articles, topics, libraries, and curated series. It's free of ads and payments, and YouTube is the only video provider.

## How it adds independent value

This is the case for the main question below, and should be demonstrable on the live site:

- **Human curation.** Editors choose which channels and playlists to follow, and hide anything that doesn't fit. Since 2026-11-07, each video is no longer reviewed before it appears (plan D10).
- **A knowledge network** connecting videos to articles, topics, and libraries, which YouTube doesn't offer.
- **Original articles** written by the team, with sources.
- **Arabic-first organisation** by subject rather than by channel or popularity.
- **Its own recommendations:** transparent category-based scoring, with no use of YouTube's statistics for ranking.

## Open questions for YouTube

| # | Question | Policy | Position |
|---|---|---|---|
| 1 | **Is a curated, multi-channel vertical feed allowed?** | III.I.1 (replicating core experiences), III.E.2 (aggregating across content owners), and the policy guide's example of an "identical copy of YouTube" | The largest risk in the project. Built for independent value, as above. Explicit permission from channel owners would also help, and should be sought. |
| 2 | Does a one-time, non-blocking notice satisfy the requirement to agree to the privacy policy before access? | III.A.2 | Chosen because the product must not interrupt guests. If not, a consent step can be added. |
| 3 | May statistics be shown and stored for 30 days? | III.E.4, and the policy guide on audited developers | Built and turned off. Not available on the settings screen until this is answered. |
| 4 | Does the "most opened" list on Explore meet the rule on internal metrics? | III.E.4.h | Uses only people signed in on this site, is labelled as not from YouTube, and doesn't use YouTube's numbers. |

## How each requirement is met

Evidence is the automated tests, unless it says otherwise. They run with a stand-in for YouTube's player and API, so **real-device behaviour is not covered** where noted.

### Player

| Requirement | How | Evidence |
|---|---|---|
| Official embedded player only. No download or re-hosting. | The IFrame Player API, and nothing else | Code; `feed.spec.ts` |
| Nothing in front of the player | Text and controls are outside it, and the privacy notice is in the page flow | `feed.spec.ts` checks what's on top; `hardening.spec.ts` |
| Controls, branding, and end screen | The feed uses the documented `controls=0` parameter, so the control bar is off there, and the rules forbid only changes the API documentation doesn't describe. Other pages keep it on. No imitation controls in front of the player. A video's end stays on its end screen, and "next" is outside. **Worth raising with the reviewer.** | `feed.spec.ts`, `playlists.spec.ts` |
| No mouseover or touch events on the player | Swipes come from outside it | Code. **Real phones not tested.** |
| Autoplay muted, only above 50% visible, only one player | IntersectionObserver with a threshold above 0.5, one active player | `feed.spec.ts`. **Real autoplay only in emulated Chromium.** |
| At least 200×200 | Checked | `feed.spec.ts` |
| Nothing plays in the background | Pauses when hidden or scrolled away | `feed.spec.ts` |
| Referrer sent | `Referrer-Policy: strict-origin-when-cross-origin` | `hardening.spec.ts`, `real-player.spec.ts` |

### Data

| Requirement | How | Evidence |
|---|---|---|
| Stored data refreshed or removed within 30 days | Daily job, oldest first. Anything older with nothing fresher is withdrawn, even without API access. | `feed.test.ts`, `playlists.test.ts` |
| Import previews within 30 days | The old importer's previews are removed by a 29-day TTL index. Sources store no previews. | **Automatic removal itself not observed.** |
| Deleted videos noticed within 30 days | The same job, which clears their data | `feed.test.ts` |
| Statistics off | No way to enable them on screen | `admin-system.test.ts` |
| Statistics not used for ranking | Scoring has no input for them | `scoring.test.ts`; `discovery.test.ts` |
| Titles and descriptions not altered | Services accept no such field for YouTube content | `feed.test.ts` |
| Attribution on every item | Cards, search results, suggestions, saved items, history, playlists. In the feed, a labelled YouTube button beside each video, which opens it on YouTube. | `discovery.spec.ts`, `playlists.spec.ts` |
| Comments read-only, labelled, not stored | Fetched on request | `youtube-api.test.ts` |
| No YouTube OAuth scopes | Only `openid`, `email`, `profile` | `auth-infrastructure.test.ts` |
| API calls come from one module | `lib/youtube`, and feed rendering makes none | `feed.test.ts` |
| Uploads playlist used, requests batched, no retry on `quotaExceeded` | See [YOUTUBE_INTEGRATION.md](YOUTUBE_INTEGRATION.md) | `sources.test.ts`, `youtube-api.test.ts` |
| Shorts detection gives a suggestion only | **Not met since 2026-11-07:** sources publish with the suggested kind, and admins correct it afterwards (plan D10) | `sources.test.ts`, `feed.test.ts` |

### Privacy

| Requirement | How | Evidence |
|---|---|---|
| A privacy policy, linked and available | `/privacy`, with a link in the footer, the account menu, and the notice | `hardening.spec.ts` |
| States YouTube API use, and links Google's privacy policy and YouTube's terms | Yes | `hardening.spec.ts` |
| Explains cookies, and how to revoke access | Yes, including a link to Google's security settings | `hardening.spec.ts` |
| A way to delete stored data | `/account` | `hardening.test.ts`, `hardening.spec.ts` |
| A contact | Shown when configured. **Not yet supplied.** | Needs the owner |
| Legal review | **Not done.** I drafted the text, and it isn't legal advice. | Needs a qualified person |

## Quota

If asked to justify usage. A channel of 10,000 videos costs about 400 units to fetch the first time. After that, an hourly check costs about 1 unit per followed channel when nothing is new, so 50 channels use about 1,200 units a day, plus about 2 units per 50 items for each YouTube playlist. The hourly job stops at a configurable ceiling, 8,000 units by default. By calculation, the daily refresh at its default limits uses at most about 80 units: 20 batches of videos, 10 playlists, and 50 channels. So the default 10,000 units a day should be enough, and no increase is needed yet. Real use hasn't been measured, because no real channel has been imported.
