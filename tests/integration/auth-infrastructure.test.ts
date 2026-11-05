import type { PrismaClient } from "@prisma/client";
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuthAdapter } from "@/lib/auth/adapter";
import { AppError } from "@/lib/errors";
import { checkRateLimit, enforceRateLimit } from "@/lib/rate-limit";
import { clearDatabase, createTestClient } from "./helpers";

let prisma: PrismaClient;
let adapter: Required<Adapter>;

const newUser = (overrides: Record<string, unknown> = {}) =>
  ({ name: "اسم", email: "person@example.com", image: "https://example.com/a.png", emailVerified: null, ...overrides }) as unknown as AdapterUser;

beforeAll(() => {
  prisma = createTestClient();
  adapter = createAuthAdapter(prisma) as Required<Adapter>;
});

beforeEach(async () => {
  await clearDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("creating accounts", () => {
  it("creates a normal user, with no privileges", async () => {
    const user = await adapter.createUser(newUser());
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ role: "USER", permissionGrants: [], isDeactivated: false });
  });

  it("ignores anything in a provider profile beyond the expected fields", async () => {
    const user = await adapter.createUser(newUser({ role: "SUPER_ADMIN", permissionGrants: ["users.manage"], isDeactivated: true }));
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ role: "USER", permissionGrants: [], isDeactivated: false });
  });

  it("stores and finds email addresses in lowercase", async () => {
    await adapter.createUser(newUser({ email: "Person@Example.COM" }));
    expect((await adapter.getUserByEmail("PERSON@example.com"))?.email).toBe("person@example.com");
  });

  it("keeps only the link to Google, not its tokens", async () => {
    const user = await adapter.createUser(newUser());
    await adapter.linkAccount({
      userId: user.id,
      type: "oauth",
      provider: "google",
      providerAccountId: "google-123",
      access_token: "secret-access",
      refresh_token: "secret-refresh",
      id_token: "secret-id",
      scope: "openid email profile",
    } as AdapterAccount);

    const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
    expect(account).toMatchObject({ provider: "google", providerAccountId: "google-123", access_token: null, refresh_token: null, id_token: null });
    expect((await adapter.getUserByAccount({ provider: "google", providerAccountId: "google-123" }))?.id).toBe(user.id);
  });
});

describe("reading sessions", () => {
  const expires = () => new Date(Date.now() + 86_400_000);

  it("returns the user's current role, so a change applies to the next request", async () => {
    const user = await adapter.createUser(newUser());
    await adapter.createSession({ sessionToken: "token", userId: user.id, expires: expires() });

    await prisma.user.update({ where: { id: user.id }, data: { role: "EDITOR" } });

    const result = await adapter.getSessionAndUser("token");
    expect((result?.user as unknown as { role: string }).role).toBe("EDITOR");
  });

  it("refuses a deactivated user straight away, even with a valid session still stored", async () => {
    const user = await adapter.createUser(newUser());
    await adapter.createSession({ sessionToken: "token", userId: user.id, expires: expires() });
    expect(await adapter.getSessionAndUser("token")).not.toBeNull();

    await prisma.user.update({ where: { id: user.id }, data: { isDeactivated: true } });

    expect(await adapter.getSessionAndUser("token")).toBeNull();
  });

  it("returns nothing for a token that doesn't exist", async () => {
    expect(await adapter.getSessionAndUser("no-such-token")).toBeNull();
  });

  it("deleting a session that's already gone isn't an error, as when requests overlap", async () => {
    const user = await adapter.createUser(newUser());
    await adapter.createSession({ sessionToken: "token", userId: user.id, expires: expires() });

    await Promise.all([adapter.deleteSession("token"), adapter.deleteSession("token"), adapter.deleteSession("token")]);

    expect(await prisma.session.count()).toBe(0);
  });
});

describe("rate limiting", () => {
  const rule = { scope: "test", limit: 3, windowSeconds: 60 };
  const NOW = 1_800_000_000_000;

  it("allows up to the limit and refuses after it", async () => {
    const results = [];
    for (let attempt = 0; attempt < 5; attempt += 1) results.push(await checkRateLimit(rule, "subject", NOW));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((result) => result.count)).toEqual([1, 2, 3, 4, 5]);
  });

  it("counts each subject and each scope separately", async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) await checkRateLimit(rule, "first", NOW);
    expect((await checkRateLimit(rule, "second", NOW)).allowed).toBe(true);
    expect((await checkRateLimit({ ...rule, scope: "other" }, "first", NOW)).allowed).toBe(true);
  });

  it("starts fresh in the next window", async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) await checkRateLimit(rule, "subject", NOW);
    expect((await checkRateLimit(rule, "subject", NOW + 60_000)).allowed).toBe(true);
  });

  it("counts every one of many simultaneous requests", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => checkRateLimit({ ...rule, limit: 10 }, "busy", NOW)));
    expect(results.filter((result) => result.allowed)).toHaveLength(10);
    expect(results.map((result) => result.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
    expect(await prisma.rateLimitBucket.count()).toBe(1);
  });

  it("stores a real date, which the TTL index needs in order to remove old buckets", async () => {
    await checkRateLimit(rule, "subject", NOW);
    const bucket = await prisma.rateLimitBucket.findFirstOrThrow();
    expect(bucket.expiresAt).toBeInstanceOf(Date);
    expect(bucket.expiresAt.getTime()).toBeGreaterThan(NOW);
    expect(bucket.expiresAt.getTime()).toBeLessThanOrEqual(NOW + 60_000);
  });

  it("reports a safe error when enforcing", async () => {
    const strict = { scope: "strict", limit: 1, windowSeconds: 3600 };
    await enforceRateLimit(strict, "subject");
    await expect(enforceRateLimit(strict, "subject")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(enforceRateLimit(strict, "subject")).rejects.toBeInstanceOf(AppError);
  });
});
