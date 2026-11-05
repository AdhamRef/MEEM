# Product specification, as built

What the product does today. The requirements are in [MASTER_SPECIFICATION.md](MASTER_SPECIFICATION.md), which isn't edited. This describes the result, and where it differs and why (§32).

## The product

A free, Arabic-only, right-to-left platform for discovering Islamic knowledge, connecting short videos to deeper material. There are no payments or ads, and no account is needed to browse.

## Public pages

| Page | What it does |
|---|---|
| `/` | The vertical Shorts feed, for you or by category, with infinite loading |
| `/shorts/[id]`, `/videos/[id]` | A shareable Short opening in the feed, and a long video's own page, with read-only YouTube comments |
| `/explore` | Editorially organised: categories, featured topics, collections, libraries, selected playlists and articles, what's new, and what's most opened |
| `/search` | Search across all content types, with type and category filters, suggestions, and paging |
| `/topics`, `/topics/[slug]` | Topics, and everything connected to one |
| `/articles/[slug]` | An article with contents, reading progress, sources, and related content |
| `/libraries`, `/libraries/[slug]` | Knowledge libraries |
| `/playlists`, `/playlists/[slug]` | Curated series and YouTube playlists |
| `/resources/[slug]` | An external resource, clearly marked as external |
| `/interests` | Choose or reset interests, as a guest or signed in |
| `/saved`, `/history` | Saved items, recently opened items, and continuing unfinished videos |
| `/account` | Your account and data, including deleting it |
| `/privacy`, `/terms` | Privacy policy and terms of use |
| `/auth/signin` | Optional Google sign-in |

## The dashboard

`/admin`, with the sections in §19.2, plus resources, collections, and YouTube status. See [ADMIN_GUIDE.md](ADMIN_GUIDE.md).

Five roles: user, contributor, scientific reviewer, editor, and admin, plus the one super admin. Permissions are checked in the services, on every action. Articles go from draft to published, and a reviewer can comment but is never a required step.

## Recommendations

Transparent, category-based scoring, with weights set in the dashboard: chosen interests, plus watch signals that fade over time, plus a configurable share of exploration. There's no AI, and nothing is inferred about a person's beliefs or identity. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Where it differs from the specification

| Specification | As built | Why |
|---|---|---|
| Text and controls over the video, TikTok style | Beside the video on desktop, and below it on phones | YouTube forbids anything in front of its player (L1) |
| Swiping on the video | Swipe from the panel and margins, plus buttons and keyboard | The player owns its touches, and policy forbids using them to trigger actions (L2). **Real phones haven't confirmed how this feels.** |
| Autoplay with sound | Starts muted, with a sound control outside the player | Browsers block it (L3) |
| Title, channel, and description shown with each feed video (§5.2) | The feed shows only the video and a column of actions beside it. The player shows its own title, and screen readers still get them. Pages for a single video show everything. | The owner's decision of 2026-11-05, to give the video more room |
| Certain Shorts detection | Length gives a candidate, and a person decides | The API has no such flag (L5) |
| Posting YouTube comments | Read-only, labelled as YouTube's | Posting would need YouTube authorisation, which isn't requested (L6) |
| Resume in YouTube playlists | Best effort, from what was seen playing here | Progress is only visible while playing on this site (L7) |
| `/c/` channel addresses | Asks for the `@handle` | The API has no direct lookup, and search costs 100 quota units (L8) |
| A `Short` model | One `Video` model with a kind | Playlists and topics need both kinds, and duplicates are prevented across them (D3) |
| Statistics | Built, and off | YouTube limits storing them, until the audit says otherwise (D6, R2) |
| "Popular" | Only real use of this site, labelled, and hidden until there's enough | Nothing may be invented, and it must be clear it's not from YouTube (R6) |
| Auth.js v5 style naming | `next-auth` 4 | v5 is still in beta (D1) |

## Additions the owner approved (D5)

`/privacy`, `/terms`, a one-time privacy notice, `/videos/[id]`, `/admin/resources`, `/admin/youtube-status`, collections, review notes, and deleting your account.

## Added while building, without separate approval

Listed in [PROJECT_STATUS.md](PROJECT_STATUS.md) under "Proposed, awaiting approval". They include searching external resources alongside the six required types, and `/admin/collections`, without which Explore's collections couldn't be made.

## Known limits

- **Search** matches whole words, so "صلاته" doesn't find "صلاة", and "الصلاة" doesn't find "والصلاة". See [ARCHITECTURE.md](ARCHITECTURE.md#search).
- **Only Arabic,** as specified, with text kept in one module so that later translation stays possible.
- **The dashboard guide is in English,** while its readers read Arabic.
- **Section 29's deferred features** aren't built, including internal likes, comments, follows, and messaging.

Open risks, and what hasn't been tested, are in [PROJECT_STATUS.md](PROJECT_STATUS.md).
