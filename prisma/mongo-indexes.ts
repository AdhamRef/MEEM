/**
 * MongoDB indexes that Prisma's schema language cannot express.
 * Regular and unique indexes belong in schema.prisma instead.
 *
 * `prisma db push` deletes these, so `npm run db:sync` recreates them after every push.
 */
export interface MongoIndexDefinition {
  collection: string;
  name: string;
  key: Record<string, 1 | -1 | "text">;
  options?: {
    expireAfterSeconds?: number;
    default_language?: string;
    weights?: Record<string, number>;
    unique?: boolean;
    partialFilterExpression?: Record<string, string>;
  };
}

/**
 * MongoDB has no Arabic text-search language. "none" disables stemming and stop words;
 * Arabic normalisation happens in the application before text reaches searchText.
 * Words in searchText are stored once each, so word counts can't rank a title above a passing
 * mention. The weight on titleSearch does that.
 */
const textIndex = (collection: string): MongoIndexDefinition => ({
  collection,
  name: `${collection}_searchText_text`,
  key: { searchText: "text", titleSearch: "text" },
  options: { default_language: "none", weights: { titleSearch: 5, searchText: 1 } },
});

/** Documents are removed once the date in this field passes. */
const expiryIndex = (collection: string, field: string): MongoIndexDefinition => ({
  collection,
  name: `${collection}_${field}_ttl`,
  key: { [field]: 1 },
  options: { expireAfterSeconds: 0 },
});

export const mongoIndexes: MongoIndexDefinition[] = [
  textIndex("Video"),
  textIndex("Article"),
  textIndex("Topic"),
  textIndex("Library"),
  textIndex("Playlist"),
  textIndex("ExternalResource"),

  // One view per person and item, so history lists each thing once and "popular" counts people.
  {
    collection: "UserActivity",
    name: "UserActivity_one_view_per_item",
    key: { userId: 1, entityType: 1, entityId: 1 },
    options: { unique: true, partialFilterExpression: { action: "VIEW" } },
  },

  expiryIndex("Session", "expires"),
  // YouTube metadata snapshots must not outlive the 30-day policy limit.
  expiryIndex("ImportCandidate", "expiresAt"),
  expiryIndex("UserActivity", "expiresAt"),
  expiryIndex("RateLimitBucket", "expiresAt"),
];
