import type { PrismaClient } from "@prisma/client";
import { mongoIndexes, type MongoIndexDefinition } from "../../../prisma/mongo-indexes";

/** Creates each index if needed. Safe to run repeatedly, since MongoDB skips matches. */
export async function ensureMongoIndexes(
  prisma: PrismaClient,
  indexes: MongoIndexDefinition[] = mongoIndexes,
): Promise<string[]> {
  for (const index of indexes) {
    await prisma.$runCommandRaw({
      createIndexes: index.collection,
      indexes: [{ name: index.name, key: index.key, ...index.options }],
    });
  }
  return indexes.map((index) => index.name);
}

export async function listIndexNames(prisma: PrismaClient, collection: string): Promise<string[]> {
  const result = (await prisma.$runCommandRaw({ listIndexes: collection })) as {
    cursor: { firstBatch: { name: string }[] };
  };
  return result.cursor.firstBatch.map((index) => index.name);
}
