import type { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  assertPermission,
  assertSignedIn,
  GRANTABLE_PERMISSIONS,
  hasPermission,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Actor,
  type Permission,
} from "./index";

const STAFF_ROLES: UserRole[] = ["CONTRIBUTOR", "SCIENTIFIC_REVIEWER", "EDITOR", "ADMIN", "SUPER_ADMIN"];

const actor = (role: UserRole, permissionGrants: string[] = []): Actor => ({ id: "a", email: "a@example.com", role, permissionGrants });

function codeOf(work: () => void): string | undefined {
  try {
    work();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : "UNEXPECTED";
  }
}

describe("permission matrix", () => {
  it("gives a normal user nothing", () => {
    for (const permission of PERMISSIONS) expect(hasPermission(actor("USER"), permission)).toBe(false);
  });

  it("gives the super admin everything", () => {
    for (const permission of PERMISSIONS) expect(hasPermission(actor("SUPER_ADMIN"), permission)).toBe(true);
  });

  it("lets all five staff roles reach the dashboard", () => {
    for (const role of STAFF_ROLES) expect(hasPermission(actor(role), "admin.access")).toBe(true);
  });

  it.each<[UserRole, Permission, boolean]>([
    // §19.4 contributor: creates and edits assigned drafts, and can't publish without a grant.
    ["CONTRIBUTOR", "content.create", true],
    ["CONTRIBUTOR", "content.editAssigned", true],
    ["CONTRIBUTOR", "content.editAny", false],
    ["CONTRIBUTOR", "content.publish", false],
    // §19.4 reviewer: reviews and may edit, never manages settings or privileged users.
    ["SCIENTIFIC_REVIEWER", "content.review", true],
    ["SCIENTIFIC_REVIEWER", "settings.manage", false],
    ["SCIENTIFIC_REVIEWER", "users.manage", false],
    // §19.4 editor: creates, edits, and manages topics, never privileged accounts.
    ["EDITOR", "content.editAny", true],
    ["EDITOR", "topics.manage", true],
    ["EDITOR", "relationships.manage", true],
    ["EDITOR", "users.manage", false],
    ["EDITOR", "settings.manage", false],
    // §19.4 admin: most administrative work, but not roles or settings.
    ["ADMIN", "content.publish", true],
    ["ADMIN", "categories.manage", true],
    ["ADMIN", "youtube.import", true],
    ["ADMIN", "audit.view", true],
    ["ADMIN", "users.manage", false],
    ["ADMIN", "settings.manage", false],
  ])("%s %s is %s", (role, permission, expected) => {
    expect(hasPermission(actor(role), permission)).toBe(expected);
  });

  it("never makes the reviewer role a publishing stage", () => {
    expect(ROLE_PERMISSIONS.SCIENTIFIC_REVIEWER).not.toContain("content.publish");
  });
});

describe("individual grants", () => {
  it("lets a contributor publish once explicitly granted", () => {
    expect(hasPermission(actor("CONTRIBUTOR", ["content.publish"]), "content.publish")).toBe(true);
  });

  it("does nothing for someone who isn't staff", () => {
    expect(hasPermission(actor("USER", ["content.publish"]), "content.publish")).toBe(false);
  });

  it.each(["users.manage", "settings.manage", "categories.manage", "admin.access"])("ignores a stored grant of %s, which isn't grantable", (grant) => {
    expect(hasPermission(actor("CONTRIBUTOR", [grant]), grant as Permission)).toBe(grant === "admin.access");
    expect(hasPermission(actor("USER", [grant]), grant as Permission)).toBe(false);
  });

  it("keeps account and settings powers out of the grantable list", () => {
    for (const permission of ["users.manage", "users.view", "settings.manage", "audit.view", "admin.access"]) {
      expect(GRANTABLE_PERMISSIONS).not.toContain(permission);
    }
  });
});

describe("assertions", () => {
  it("separates not signed in from not allowed", () => {
    expect(codeOf(() => assertPermission(null, "admin.access"))).toBe("UNAUTHENTICATED");
    expect(codeOf(() => assertPermission(actor("USER"), "admin.access"))).toBe("FORBIDDEN");
    expect(codeOf(() => assertPermission(actor("EDITOR"), "admin.access"))).toBeUndefined();
    expect(codeOf(() => assertSignedIn(null))).toBe("UNAUTHENTICATED");
    expect(codeOf(() => assertSignedIn(actor("USER")))).toBeUndefined();
  });
});
