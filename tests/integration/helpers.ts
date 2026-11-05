import { PrismaClient } from "@prisma/client";

export function createTestClient(): PrismaClient {
  return new PrismaClient();
}

/** Clears documents while keeping collections and their indexes. */
export async function clearDatabase(prisma: PrismaClient): Promise<void> {
  const result = (await prisma.$runCommandRaw({ listCollections: 1, nameOnly: true })) as {
    cursor: { firstBatch: { name: string }[] };
  };
  // Together rather than in turn: there are about 50 collections, and this runs before every test.
  await Promise.all(result.cursor.firstBatch.map(({ name }) => prisma.$runCommandRaw({ delete: name, deletes: [{ q: {}, limit: 0 }] })));
}
