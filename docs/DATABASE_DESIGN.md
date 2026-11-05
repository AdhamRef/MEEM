# Database design

MongoDB through Prisma ORM 6. The schema is [prisma/schema.prisma](../prisma/schema.prisma), and indexes Prisma cannot express are in [prisma/mongo-indexes.ts](../prisma/mongo-indexes.ts).

## Applying the schema

Prisma Migrate does not support MongoDB, so there are no migration files.

```bash
npm run db:sync   # prisma db push, then recreates the text and TTL indexes
```

**Never run `prisma db push` on its own.** It creates the indexes declared in the schema, but it also **deletes every index the schema doesn't declare**, which includes all the text and TTL indexes below. An integration test records this behaviour. Without those indexes, search queries fail and expired data, including YouTube import previews under the 30-day limit, stops being removed.

**Before changing a production schema:**

- Search is unavailable and TTL cleanup stops between the push and the end of index creation, so run `db:sync` during a quiet period. Large collections take longer to re-index.
- Adding a unique index fails if existing data has duplicates, so check first.
- Removing a field does not remove its data from existing documents.

## Rules that shape the schema

| Rule | Reason | Example |
|---|---|---|
| A replica set is mandatory | Prisma uses transactions, including internally for nested writes | Atlas, or `npm run db:dev` locally |
| Optional fields are never `@unique` | MongoDB's unique index treats null and missing as one value, so a second empty value would conflict | `Playlist.sourceKey` holds `yt:<id>` or `cur:<uuid>`; `youtubePlaylistId` is not unique |
| Optional fields are not part of "active" filters | Prisma does not treat a missing field as equal to `null` in filters | `isArchived` is a required boolean, alongside the informational `archivedAt` |
| `createMany` cannot skip duplicates on MongoDB | Prisma's `skipDuplicates` is not supported here | The importer checks existing IDs first, then handles `P2002` conflicts |
| Foreign keys do not exist | Prisma emulates referential actions; polymorphic links have none | Services validate polymorphic references |

## Content status

`DRAFT` and `PUBLISHED` are the only statuses (§12.3). Archiving is the separate `isArchived` flag, which hides content but keeps references intact. Public queries filter on `status: PUBLISHED, isArchived: false`, and a link to hidden content simply does not render.

## Relationships

**Explicit join models** represent the many-to-many pairs in §13.1. Each has a compound unique index, which prevents duplicates, and an index on its other side:

`ArticleTopic`, `ArticleLibrary`, `ArticleVideo`, `ArticlePlaylist`, `VideoTopic`, `VideoLibrary`, `PlaylistTopic`, `PlaylistLibrary`, `ResourceTopic`, `ResourceLibrary`, `LibraryTopic`, `PlaylistItem`.

`ArticleLibrary` and `VideoLibrary` also hold `isFeatured`, which marks the items that lead a library's landing page (§14).

**Hierarchies** use `parentId` on `Category`, `Topic`, and `Library`. MongoDB requires `NoAction` on self-relations, so services prevent cycles and handle children when deleting.

**`TopicRelation` and `LibraryRelation`** link peers. Services reject self-links and store symmetric pairs in a canonical order.

**`ContentRelation`** holds the optional editorial links in §13.2, between any two content items. It is polymorphic because those links cross every type, so its service validates both ends. `Favorite`, `UserActivity`, and `CollectionItem` are polymorphic for the same reason.

**Copies for speed:** `Video.topicIds` and `Video.libraryIds` duplicate `VideoTopic` and `VideoLibrary`, because the feed filters on them constantly and joining through Prisma on MongoDB is slow. The join models are the source of truth. One service function writes both in a transaction.

## One `Video` model

Shorts and long-form videos share `Video`, separated by `kind`. Playlists, topics, and articles all reuse the same records, as §12.6 requires, and `youtubeVideoId` stays globally unique.

- `classification` is the automatic candidate signal.
- `kind` is the decision, and `reviewedAt` records that a person confirmed it.

## YouTube data retention

YouTube's policies limit how long API data may be kept, so:

- `metadataFetchedAt` is indexed, and a refresh job keeps each record under 30 days old.
- `ImportCandidate` has a TTL index, so import previews remove themselves.
- `stats` carries its own `fetchedAt`, so old values can be identified and hidden.

Fields sourced from YouTube are never edited locally.

## Script-managed indexes

| Index | Collections | Purpose |
|---|---|---|
| Text on `searchText` and `titleSearch`, `default_language: none`, weighted 1 and 5 | `Video`, `Article`, `Topic`, `Library`, `Playlist`, `ExternalResource` | Search. MongoDB has no Arabic language, so normalisation happens in the application. Words in `searchText` are stored once each, so the weight is what ranks a title above a passing mention. |
| Unique on user, type, and item where `action` is `VIEW` | `UserActivity` | One view per person and item. History lists each thing once, and counting records counts people. |
| TTL on `expires` | `Session` | Removes expired sessions |
| TTL on `expiresAt` | `ImportCandidate`, `UserActivity`, `RateLimitBucket` | Automatic cleanup. Each document sets its own expiry, so retention stays configurable. |

`AuditLog` deliberately has no TTL (§20.4).

## Supporting models beyond §20.1

| Model | Why it exists |
|---|---|
| `Collection`, `CollectionItem` | Curated groupings for Explore (§11.3, §16) |
| `ReviewNote` | Scientific reviewer feedback that never blocks publishing (§19.4) |
| `ImportJob`, `ImportCandidate` | Resumable import progress and preview (§7) |
| `ApiQuotaUsage` | Quota awareness (§6.6, §7.3) |
| `RateLimitBucket` | Rate limiting across instances without Redis (§21) |

`VerificationToken` is omitted because Google-only sign-in does not use it (§20.1 says "if required"). Roles are an enum plus individual grants on `User`, so there is no `Role` collection.
