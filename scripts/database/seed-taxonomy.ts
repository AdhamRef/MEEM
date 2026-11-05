import "../load-env";
import { PrismaClient } from "@prisma/client";
import { seedTaxonomy } from "../../src/features/categories/seed-taxonomy";

const prisma = new PrismaClient();

try {
  const { created, alreadyPresent } = await seedTaxonomy(prisma);
  console.log(`Categories created: ${created.length}. Already present and left unchanged: ${alreadyPresent}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
