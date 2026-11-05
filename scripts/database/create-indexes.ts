import "../load-env";
import { PrismaClient } from "@prisma/client";
import { ensureMongoIndexes } from "../../src/lib/prisma/ensure-indexes";

const prisma = new PrismaClient();

try {
  const names = await ensureMongoIndexes(prisma);
  console.log(`Ensured ${names.length} MongoDB indexes:\n  ${names.join("\n  ")}`);
} catch (error) {
  console.error("Could not create indexes:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
