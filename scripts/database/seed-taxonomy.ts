import "../load-env";
import { PrismaClient } from "@prisma/client";
import { seedTopics } from "../../src/features/topics/seed-topics";

const prisma = new PrismaClient();

try {
  const { created, alreadyPresent } = await seedTopics(prisma);
  console.log(`Topics created: ${created.length}. Already present and left unchanged: ${alreadyPresent}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
