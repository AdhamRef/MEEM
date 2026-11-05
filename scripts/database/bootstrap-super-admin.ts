import "../load-env";
import { PrismaClient } from "@prisma/client";
import { bootstrapSuperAdmin } from "../../src/features/users/bootstrap-super-admin.service";

const email = process.argv[2];

if (!email) {
  console.error("Usage: npm run db:bootstrap-admin -- you@example.com");
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const result = await bootstrapSuperAdmin(prisma, email);
  console.log(`${result.email} is now the super admin.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
