import type { PrismaClient, UserRole } from "@prisma/client";
import type { Actor } from "@/lib/permissions";

let counter = 0;

/** A real user record, returned as the Actor a signed-in request would carry. */
export async function createActor(prisma: PrismaClient, role: UserRole, permissionGrants: string[] = []): Promise<Actor> {
  counter += 1;
  const user = await prisma.user.create({ data: { email: `person-${counter}@example.com`, role, permissionGrants } });
  return { id: user.id, email: user.email, role, permissionGrants };
}
