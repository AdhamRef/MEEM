import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { PrismaClient, type UserRole } from "@prisma/client";
import { E2E_DATABASE_URL } from "./constants";

export const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });

export interface SeededAccount {
  id: string;
  email: string;
  name: string;
  sessionToken: string;
}

/**
 * Creates a real user and a real session record, then gives the browser the same cookie
 * NextAuth would set. The whole server path runs for real, and no test-only login provider
 * has to exist in the application.
 */
export async function createAccount(role: UserRole = "USER", name = "مستخدم الاختبار"): Promise<SeededAccount> {
  const email = `e2e-${randomUUID()}@example.com`;
  const sessionToken = randomUUID();
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      sessions: { create: { sessionToken, expires: new Date(Date.now() + 86_400_000) } },
    },
  });
  return { id: user.id, email, name, sessionToken };
}

export async function signInBrowser(context: BrowserContext, baseURL: string, sessionToken: string): Promise<void> {
  await context.addCookies([{ name: "next-auth.session-token", value: sessionToken, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}

export async function selectedCategoryTitles(userId: string): Promise<string[]> {
  const interests = await prisma.userInterest.findMany({ where: { userId, isSelected: true }, include: { category: { select: { title: true } } } });
  return interests.map((interest) => interest.category.title).sort();
}
