# Dashboard guide

For the volunteers who run the platform. Open the dashboard at `/admin`. You'll see only the sections your role allows.

## Who can do what

| Role | Can do |
|---|---|
| Contributor | Write drafts, and edit drafts they wrote or were assigned |
| Scientific reviewer | Read everything, leave review notes, and edit drafts assigned to them. Notes never block publishing. |
| Editor | Write and edit any content, and manage topics, libraries, playlists, and relationships |
| Admin | All of the above, plus publishing, archiving, deleting, adding content sources from YouTube, and viewing users and the activity log |
| Super admin | All of the above, plus roles and settings |

**Publishing is separate from editing.** Editors and contributors need an individual permission from the super admin to publish. The super admin can also grant contributors and reviewers extra permissions.

## Adding content: Sources

Everything comes in through **Content sources** (`/admin/sources`). Paste a link in the box and press **Add**. The kind of link is worked out for you:

- **A channel**, by its address or its `@handle`: the site follows it. Its videos are fetched and published as they arrive, newest first. A bar shows how far it has got. Older addresses containing `/c/` don't work, so open the channel and copy its `@handle` instead.
- **A playlist**, by its address: its videos are added and published, and the playlist gets its own page on the site.
- **One or more videos**: paste their links, one per line (Shift and Enter starts a new line). They're published at once. Their channel is saved but not followed.

**New content is published automatically.** Every followed channel and every YouTube playlist is checked once an hour, and what's new goes live. Whether a video is a Short or a long video is decided by its length and shape. You can change it afterwards.

**A first fetch goes fastest with the page open.** While the Sources page or the channel's page is open, the site keeps fetching without stopping. If you close it, the hourly check carries on from the same place. Nothing is lost either way.

**If it says the daily quota has run out,** nothing is lost. Fetching continues by itself after midnight Pacific time. The hourly check also stops by itself once the day's usage reaches the ceiling in **Settings**, so some quota is always left for you.

### Managing a channel

Open a channel from the list to see all its videos.

- **To hide videos**, tick them, or use the select-all box to take everything the filter matches across every page, then press **Unpublish**. **Publish** shows them again. A hidden video stays hidden: later checks never bring it back.
- **Filters** show everything, only what's published, or only what's hidden, and Shorts or long videos.
- **Check now** looks for new videos straight away, rather than waiting for the hour.
- **Stop following**, in the menu, ends the hourly checks. The channel's videos stay exactly as they are. Stopped channels, and the channels of videos added on their own, are listed under **Saved channels not followed**, where **Follow** starts them again.

## Giving channels their topics

**This is the one place video topics are decided.** Every video of a channel belongs to all of its topics, including videos added later.

1. Open the channel from **Content sources**, then press **Edit topics**. You can also open a topic and add channels under **Channels**. Both change the same link.
2. Search for a topic and pick it. A channel can have several. Changes save immediately and reach visitors within a minute or so.

A topic shows on the first visit only once it's published and has a channel with a published video. Visitors who chose that topic get its channels switched on by default.

## Publishing videos

Use **Videos**. A video can be published as long as it's available on YouTube, can be embedded, and isn't archived. Its topics come from its channel, so there's nothing to sort. Until a channel has a topic, its videos appear only for people who haven't chosen topics, and not under any topic.

Pressing **Publish** counts as your review of that video. The kind, Short or long, is a suggestion based on length, so a short wide video may be labelled a Short until someone corrects it.

To do many at once, tick them, or use the select-all box to take everything your filters match across every page, then press **Publish**. It skips only videos that can't play, and tells you how many. You can set the kind the same way, before or after.

On a video's own page you can also add a button that leads viewers to an article, topic, playlist, the full video, or another site, and link it to libraries and articles.

YouTube's title and description can't be edited. YouTube requires this.

## Writing an article

Use **Articles**, then **Add**.

- Save as often as you like. It stays a draft until someone with permission publishes it.
- **Preview** shows exactly what readers will see.
- Everything under "Connections" is optional: topics, libraries, videos, playlists, and related content.
- Add a short description to images, for readers who can't see them.
- **Select text** to get a small menu for bold, italic, underline, highlight, and links. The toolbar also has strikethrough, alignment, lists, quotes, dividers, images, and footnotes.
- **Boxes** (the dashed square) set a passage apart as a verse (آية), hadith, benefit, note, or caution. Select the paragraphs first, then pick the kind. The label at the top of a box changes its kind.
- **Tables:** insert one, and table tools appear while the cursor is inside it: add rows and columns, make the first row headings, or delete. On a phone, readers scroll wide tables sideways.
- The bottom of the editor shows the word count and reading time.
- Only store an article's full text if you have the right to. For anything else, add an **external resource** with a short description and a link.

A published article's address can't change, because people may have shared it. Unpublish it first if you must.

## Topics, libraries, and playlists

- **Topics** gather everything about a subject. Their page hides whatever is empty.
- **Libraries** are larger collections. Tick the star beside an item to feature it at the top.
- **Series** are playlists you build from any channels. Drag items to reorder them, or use the arrows. Each change saves straight away.
- **YouTube playlists** are added from **Content sources**, and their contents and order come from YouTube. They're re-checked every hour, and **Sync now** on a playlist's page updates it straight away.

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
