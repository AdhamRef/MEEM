# Dashboard guide

For the volunteers who run the platform. Open the dashboard at `/admin`. You'll see only the sections your role allows.

## Who can do what

| Role | Can do |
|---|---|
| Contributor | Write drafts, and edit drafts they wrote or were assigned |
| Scientific reviewer | Read everything, leave review notes, and edit drafts assigned to them. Notes never block publishing. |
| Editor | Write and edit any content, and manage topics, libraries, playlists, and relationships |
| Admin | All of the above, plus publishing, archiving, deleting, importing from YouTube, and viewing users and the activity log |
| Super admin | All of the above, plus roles and settings |

**Publishing is separate from editing.** Editors and contributors need an individual permission from the super admin to publish. The super admin can also grant contributors and reviewers extra permissions.

## Adding videos from a channel

Use **YouTube Channel Importer**.

1. Paste the channel's address or its `@handle`, then press **Fetch videos**. Older addresses containing `/c/` don't work, so open the channel and copy its `@handle` instead.
2. Wait while the videos are fetched. You can close the page at any time and come back to it from the list of imports.
3. Review the list. Use the filter to see Short candidates, long-form candidates, what's already imported, and what you've selected.
4. Tick the videos you want, or use **Select all** to take everything the filter shows, across every page.
5. Optionally, classify what you've selected: its kind, libraries, and series. Press **Apply to selected**. Topics aren't chosen here, because videos follow their channel's topics.
6. Press **Import selected**. The numbers at the top report what was imported, already existed, was skipped, or failed.

**Nothing goes live by importing.** Every imported video is a draft.

**"Short candidate" is only a suggestion**, based on length. YouTube doesn't say which videos are Shorts, so a person has to check. Choosing a kind counts as that check. If you leave the kind on its suggestion, the video stays marked as waiting for review.

**If it says the daily quota has run out,** the import is paused rather than lost. Come back after midnight Pacific time and press **Resume**.

### Keeping an import running

**Fetching and importing only happen while the importer list, or that job's own page, is open.** With the list open, unfinished jobs run one after another, and each card shows what's really happening: running now, waiting, or stopped with the reason. Close the page and they stop, then continue from the same place when you come back. Nothing is lost.

Each card has a **stop** button, which ends the job at once, and a **delete** button, which removes the job and its list of fetched videos. Both ask first. Videos you already imported stay as drafts either way. Starting a channel that has an unfinished job takes you to that job rather than making a second one.

## Giving channels their topics

**This is the one place video topics are decided.** Every video of a channel belongs to all of its topics, including videos imported later.

1. Open **YouTube channels**, then press **Edit topics** on a channel. You can also open a topic and add channels under **Channels**. Both change the same link.
2. Search for a topic and pick it. A channel can have several. Changes save immediately and reach visitors within a minute or so.

A topic shows on the first visit only once it's published and has a channel with a published video. Visitors who chose that topic get its channels switched on by default.

## Publishing videos

Use **Videos**. A video can be published as long as it's available on YouTube, can be embedded, and isn't archived. Its topics come from its channel, so there's nothing to sort. Until a channel has a topic, its videos appear only for people who haven't chosen topics, and not under any topic.

Pressing **Publish** counts as your review of that video. The kind, Short or long, is a suggestion based on length, so a short wide video may be labelled a Short until someone corrects it.

To do many at once, tick them, or use the select-all box to take everything your filters match across every page, then press **Publish**. It skips only videos that can't play, and tells you how many. You can set the kind the same way, before or after.

On a video's own page you can also add a button that leads viewers to an article, topic, playlist, the full video, or another site, and link it to libraries and articles.

YouTube's title and description can't be edited. YouTube requires this.

## New videos from a channel you already use

Open **YouTube Channels** and press **Sync channel**. It finds only what's new since last time, and you review it the same way. Nothing checks channels automatically, so sync when you want to.

## Writing an article

Use **Articles**, then **Add**.

- Save as often as you like. It stays a draft until someone with permission publishes it.
- **Preview** shows exactly what readers will see.
- Everything under "Connections" is optional: topics, libraries, videos, playlists, and related content.
- Add a short description to images, for readers who can't see them.
- Only store an article's full text if you have the right to. For anything else, add an **external resource** with a short description and a link.

A published article's address can't change, because people may have shared it. Unpublish it first if you must.

## Topics, libraries, and playlists

- **Topics** gather everything about a subject. Their page hides whatever is empty.
- **Libraries** are larger collections. Tick the star beside an item to feature it at the top.
- **Series** are playlists you build from any channels. Drag items to reorder them, or use the arrows. Each change saves straight away.
- **YouTube playlists** are imported by address, and their contents and order come from YouTube. Press **Sync now** to update one.

Links on these pages save immediately, one at a time.

## The Explore page

Explore is the same for everyone, and most of it comes from choices you make:

| Section | What decides it |
|---|---|
| Topic chips | Published topics that have a channel, in their display order |
| Featured topics | Topics marked as featured |
| Collections | Published collections, up to 6, by display order |
| Knowledge libraries | Top-level libraries, featured ones first |
| Selected playlists | Playlists marked as featured |
| Selected articles | Articles with "show in selected articles" ticked, at the top of their edit page. Editors and admins see this. |
| Most opened | Real use of the site. It appears by itself once there's enough, and can't be set by hand. |
| Latest, and new or updated topics | Automatic, from what's published |

**To make a collection,** open Collections and create one with a title. Then add up to 12 items of any type, put them in order, and publish it. Drafts inside it stay hidden until they're published. Removing a collection removes only the grouping, never the content.

## Removing things

**Archive** hides something and keeps its links, so it's easy to undo. Use this normally.

**Delete** is permanent and removes its links. The dashboard always asks first. Sub-topics and sub-libraries move up rather than being deleted.

## For the super admin

- **Users and roles:** people appear here after signing in once. Set their role, add individual permissions, or deactivate them, which signs them out immediately. Your own account is protected, and nobody can change it.
- **Activity log:** every administrative action, which can't be edited or removed. Admins can read it too.
- **Settings:** how much of the feed is for exploration, how recommendations are weighted, how long a video can be and still be suggested as a Short, and when YouTube data refreshes.
- **YouTube status:** whether the key and daily job are set up, quota use, and what's due for a refresh. Opening it spends no quota.
