import type { PrismaClient, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAdminOverview } from "@/features/admin/overview.service";
import { createCategory, setCategoryActive, updateCategory } from "@/features/categories/categories.service";
import { DEFAULT_SCORING_CONFIG } from "@/features/recommendations/scoring";
import { getScoringConfig, SCORING_SETTING_KEY, updateScoringConfig } from "@/features/recommendations/settings.service";
import { createTopic, setTopicArchived, setTopicPublished, updateTopic } from "@/features/topics/topics.service";
import { changeUserRole, setUserDeactivated, setUserPermissionGrants } from "@/features/users/user-admin.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

let prisma: PrismaClient;
const MISSING_ID = "f".repeat(24);

async function errorCodeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
}

beforeAll(() => {
  prisma = createTestClient();
});

beforeEach(async () => {
  await clearDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("privileged operations called directly, without any UI", () => {
  type Operation = [name: string, allowedRoles: UserRole[], run: (actor: Actor | null) => Promise<unknown>];

  const operations: Operation[] = [
    ["createCategory", ["ADMIN", "SUPER_ADMIN"], (actor) => createCategory(actor, { title: "مجال تجريبي" })],
    ["createTopic", ["EDITOR", "ADMIN", "SUPER_ADMIN"], (actor) => createTopic(actor, { title: "موضوع تجريبي" })],
    ["updateScoringConfig", ["SUPER_ADMIN"], (actor) => updateScoringConfig(actor, DEFAULT_SCORING_CONFIG)],
    ["getAdminOverview", ["CONTRIBUTOR", "SCIENTIFIC_REVIEWER", "EDITOR", "ADMIN", "SUPER_ADMIN"], (actor) => getAdminOverview(actor)],
  ];

  const allRoles: UserRole[] = ["USER", "CONTRIBUTOR", "SCIENTIFIC_REVIEWER", "EDITOR", "ADMIN", "SUPER_ADMIN"];

  for (const [name, allowedRoles, run] of operations) {
    it(`${name} refuses a guest`, async () => {
      expect(await errorCodeOf(run(null))).toBe("UNAUTHENTICATED");
    });

    for (const role of allRoles) {
      const isAllowed = allowedRoles.includes(role);
      it(`${name} ${isAllowed ? "allows" : "refuses"} ${role}`, async () => {
        const actor = await createActor(prisma, role);
        expect(await errorCodeOf(run(actor))).toBe(isAllowed ? undefined : "FORBIDDEN");
      });
    }
  }

  it("a refused operation writes nothing and no audit record", async () => {
    const editor = await createActor(prisma, "EDITOR");
    await errorCodeOf(createCategory(editor, { title: "مجال" }));
    expect(await prisma.category.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe("publishing needs its own permission", () => {
  it("lets an editor draft a topic but not publish it, until granted", async () => {
    const editor = await createActor(prisma, "EDITOR");
    const topic = await createTopic(editor, { title: "التوحيد" });
    expect(topic.status).toBe("DRAFT");

    expect(await errorCodeOf(setTopicPublished(editor, topic.id, true))).toBe("FORBIDDEN");

    const granted = await createActor(prisma, "EDITOR", ["content.publish"]);
    const published = await setTopicPublished(granted, topic.id, true);
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedAt).toBeInstanceOf(Date);
  });

  it("can't publish through the update path", async () => {
    const editor = await createActor(prisma, "EDITOR");
    const topic = await createTopic(editor, { title: "التوحيد" });
    expect(await errorCodeOf(updateTopic(editor, topic.id, { status: "PUBLISHED" }))).toBe("VALIDATION");
    expect(await errorCodeOf(createTopic(editor, { title: "آخر", status: "PUBLISHED" }))).toBe("VALIDATION");
  });

  it("keeps the first publication date when republishing", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const topic = await createTopic(admin, { title: "التوحيد" });
    const first = await setTopicPublished(admin, topic.id, true);
    await setTopicPublished(admin, topic.id, false);
    const again = await setTopicPublished(admin, topic.id, true);
    expect(again.publishedAt).toEqual(first.publishedAt);
  });

  it("refuses to publish an archived topic", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const topic = await createTopic(admin, { title: "التوحيد" });
    await setTopicArchived(admin, topic.id, true);
    expect(await errorCodeOf(setTopicPublished(admin, topic.id, true))).toBe("CONFLICT");
  });
});

describe("the super admin is protected", () => {
  let superAdmin: Actor;
  let admin: Actor;

  beforeEach(async () => {
    superAdmin = await createActor(prisma, "SUPER_ADMIN");
    admin = await createActor(prisma, "ADMIN");
  });

  it("an admin can't change anyone's role, grants, or active state", async () => {
    const person = await createActor(prisma, "USER");
    expect(await errorCodeOf(changeUserRole(admin, person.id, "EDITOR"))).toBe("FORBIDDEN");
    expect(await errorCodeOf(setUserPermissionGrants(admin, person.id, ["content.publish"]))).toBe("FORBIDDEN");
    expect(await errorCodeOf(setUserDeactivated(admin, person.id, true))).toBe("FORBIDDEN");
  });

  it("an admin can't remove or override the super admin", async () => {
    expect(await errorCodeOf(changeUserRole(admin, superAdmin.id, "USER"))).toBe("FORBIDDEN");
    expect(await errorCodeOf(setUserDeactivated(admin, superAdmin.id, true))).toBe("FORBIDDEN");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: superAdmin.id } })).role).toBe("SUPER_ADMIN");
  });

  it("the super admin can't be demoted or deactivated by anyone, so access can't be lost by accident", async () => {
    const second = await createActor(prisma, "SUPER_ADMIN");
    expect(await errorCodeOf(changeUserRole(superAdmin, second.id, "USER"))).toBe("FORBIDDEN");
    expect(await errorCodeOf(changeUserRole(superAdmin, superAdmin.id, "USER"))).toBe("FORBIDDEN");
    expect(await errorCodeOf(setUserDeactivated(superAdmin, superAdmin.id, true))).toBe("FORBIDDEN");
    expect(await errorCodeOf(setUserPermissionGrants(superAdmin, second.id, ["content.publish"]))).toBe("FORBIDDEN");
  });

  it("nobody can be promoted to super admin outside the bootstrap command", async () => {
    const person = await createActor(prisma, "USER");
    expect(await errorCodeOf(changeUserRole(superAdmin, person.id, "SUPER_ADMIN"))).toBe("VALIDATION");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).role).toBe("USER");
  });

  it("rejects unknown roles and non-grantable permissions", async () => {
    const person = await createActor(prisma, "USER");
    expect(await errorCodeOf(changeUserRole(superAdmin, person.id, "OWNER"))).toBe("VALIDATION");
    expect(await errorCodeOf(setUserPermissionGrants(superAdmin, person.id, ["users.manage"]))).toBe("VALIDATION");
    expect(await errorCodeOf(setUserPermissionGrants(superAdmin, person.id, ["settings.manage"]))).toBe("VALIDATION");
  });

  it("reports a missing user and a malformed ID without a database error", async () => {
    expect(await errorCodeOf(changeUserRole(superAdmin, MISSING_ID, "EDITOR"))).toBe("NOT_FOUND");
    expect(await errorCodeOf(changeUserRole(superAdmin, { $ne: null }, "EDITOR"))).toBe("VALIDATION");
  });
});

describe("role changes and deactivation", () => {
  it("records role changes with the actor and the before and after", async () => {
    const superAdmin = await createActor(prisma, "SUPER_ADMIN");
    const person = await createActor(prisma, "USER");

    await changeUserRole(superAdmin, person.id, "EDITOR");

    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).role).toBe("EDITOR");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.role_change" } });
    expect(log).toMatchObject({ actorId: superAdmin.id, actorEmail: superAdmin.email, actorRole: "SUPER_ADMIN", entityType: "User", entityId: person.id });
    expect(log.metadata).toEqual({ previousRole: "USER", newRole: "EDITOR" });
  });

  it("deactivating deletes every session at once, and reactivating doesn't restore them", async () => {
    const superAdmin = await createActor(prisma, "SUPER_ADMIN");
    const person = await createActor(prisma, "EDITOR");
    const expires = new Date(Date.now() + 86_400_000);
    await prisma.session.createMany({
      data: [
        { sessionToken: "one", userId: person.id, expires },
        { sessionToken: "two", userId: person.id, expires },
        { sessionToken: "someone-else", userId: superAdmin.id, expires },
      ],
    });

    await setUserDeactivated(superAdmin, person.id, true);

    const deactivated = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(deactivated.isDeactivated).toBe(true);
    expect(deactivated.deactivatedAt).toBeInstanceOf(Date);
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: superAdmin.id } })).toBe(1);

    await setUserDeactivated(superAdmin, person.id, false);
    const reactivated = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(reactivated.isDeactivated).toBe(false);
    expect(reactivated.deactivatedAt).toBeNull();
    expect(await prisma.session.count({ where: { userId: person.id } })).toBe(0);
  });
});

describe("audit logging", () => {
  it("records each kind of privileged change", async () => {
    const superAdmin = await createActor(prisma, "SUPER_ADMIN");

    const category = await createCategory(superAdmin, { title: "الفقه" });
    await updateCategory(superAdmin, category.id, { description: "وصف" });
    await setCategoryActive(superAdmin, category.id, false);
    const topic = await createTopic(superAdmin, { title: "الطهارة", categoryId: category.id });
    await updateTopic(superAdmin, topic.id, { isFeatured: true });
    await setTopicPublished(superAdmin, topic.id, true);
    await setTopicArchived(superAdmin, topic.id, true);
    await updateScoringConfig(superAdmin, DEFAULT_SCORING_CONFIG);

    const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs.map((log) => log.action)).toEqual([
      "category.create",
      "category.update",
      "category.deactivate",
      "topic.create",
      "topic.update",
      "topic.publish",
      "topic.archive",
      "settings.update",
    ]);
    expect(logs.every((log) => log.actorId === superAdmin.id)).toBe(true);
  });

  it("commits with the change, so a failed change leaves no record claiming it happened", async () => {
    const admin = await createActor(prisma, "ADMIN");
    await createCategory(admin, { title: "الفقه" });
    const before = await prisma.auditLog.count();

    expect(await errorCodeOf(createCategory(admin, { title: "الفقه" }))).toBe("CONFLICT");

    expect(await prisma.auditLog.count()).toBe(before);
    expect(await prisma.category.count()).toBe(1);
  });
});

describe("scoring settings", () => {
  it("are configurable and stored, with the exploration share among them (§9.4)", async () => {
    const superAdmin = await createActor(prisma, "SUPER_ADMIN");
    expect(await getScoringConfig()).toEqual(DEFAULT_SCORING_CONFIG);

    const changed = { ...DEFAULT_SCORING_CONFIG, explorationShare: 0.35 };
    await updateScoringConfig(superAdmin, changed);
    expect((await getScoringConfig()).explorationShare).toBe(0.35);
  });

  it("refuse invalid values", async () => {
    const superAdmin = await createActor(prisma, "SUPER_ADMIN");
    expect(await errorCodeOf(updateScoringConfig(superAdmin, { explorationShare: 5 }))).toBe("VALIDATION");
  });

  it("fall back to the defaults if the stored value is damaged", async () => {
    await prisma.applicationSetting.create({ data: { key: SCORING_SETTING_KEY, value: { explorationShare: "lots" } } });
    expect(await getScoringConfig()).toEqual(DEFAULT_SCORING_CONFIG);
  });
});
