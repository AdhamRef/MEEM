import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSuperAdmin } from "@/features/users/bootstrap-super-admin.service";
import { clearDatabase, createTestClient } from "./helpers";

const prisma = createTestClient();

beforeEach(() => clearDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe("bootstrapSuperAdmin", () => {
  it("promotes an existing account and writes an audit record", async () => {
    const user = await prisma.user.create({ data: { email: "first@example.com" } });
    await bootstrapSuperAdmin(prisma, " First@Example.com ");

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.role).toBe("SUPER_ADMIN");

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: user.id } });
    expect(audit.action).toBe("role.bootstrap_super_admin");
  });

  it("refuses to run once a super admin exists", async () => {
    await prisma.user.create({ data: { email: "first@example.com", role: "SUPER_ADMIN" } });
    const other = await prisma.user.create({ data: { email: "second@example.com" } });

    await expect(bootstrapSuperAdmin(prisma, "second@example.com")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).role).toBe("USER");
  });

  it("refuses a second run even if the first super admin was later demoted", async () => {
    const first = await prisma.user.create({ data: { email: "first@example.com" } });
    await prisma.user.create({ data: { email: "second@example.com" } });
    await bootstrapSuperAdmin(prisma, "first@example.com");
    await prisma.user.update({ where: { id: first.id }, data: { role: "USER" } });

    await expect(bootstrapSuperAdmin(prisma, "second@example.com")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.user.count({ where: { role: "SUPER_ADMIN" } })).toBe(0);
  });

  it("creates exactly one super admin when runs happen at the same time", async () => {
    const emails = ["a@example.com", "b@example.com", "c@example.com", "d@example.com"];
    await prisma.user.createMany({ data: emails.map((email) => ({ email })) });

    const results = await Promise.allSettled(emails.map((email) => bootstrapSuperAdmin(prisma, email)));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: "SUPER_ADMIN" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "role.bootstrap_super_admin" } })).toBe(1);
  });

  it("does not create accounts for unknown emails", async () => {
    await expect(bootstrapSuperAdmin(prisma, "nobody@example.com")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects malformed input and deactivated accounts", async () => {
    await expect(bootstrapSuperAdmin(prisma, "not-an-email")).rejects.toMatchObject({ code: "VALIDATION" });

    await prisma.user.create({ data: { email: "gone@example.com", isDeactivated: true } });
    await expect(bootstrapSuperAdmin(prisma, "gone@example.com")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
