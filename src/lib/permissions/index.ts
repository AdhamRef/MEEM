import type { UserRole } from "@prisma/client";
import { AppError } from "@/lib/errors";

/**
 * The permission matrix from specification §19.4. Roles live in code rather than in a
 * collection, so the matrix can't drift between environments and is easy to test.
 */
export const PERMISSIONS = [
  "admin.access",
  "content.create",
  "content.editAssigned",
  "content.editAny",
  "content.viewAny",
  "content.review",
  "content.publish",
  "content.archive",
  "content.delete",
  "topics.manage",
  "relationships.manage",
  "libraries.manage",
  "playlists.manage",
  "youtube.import",
  "users.view",
  "users.manage",
  "settings.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const EDITORIAL_MANAGEMENT: Permission[] = ["topics.manage", "relationships.manage", "libraries.manage", "playlists.manage"];

const ADMIN_PERMISSIONS: Permission[] = [
  "admin.access",
  "content.create",
  "content.editAny",
  "content.viewAny",
  "content.review",
  "content.publish",
  "content.archive",
  "content.delete",
  ...EDITORIAL_MANAGEMENT,
  "youtube.import",
  "users.view",
  "audit.view",
];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  USER: [],
  CONTRIBUTOR: ["admin.access", "content.create", "content.editAssigned"],
  // No publishing or approval permission: a reviewer must never become a mandatory stage.
  SCIENTIFIC_REVIEWER: ["admin.access", "content.editAssigned", "content.viewAny", "content.review"],
  EDITOR: ["admin.access", "content.create", "content.editAny", "content.viewAny", "content.review", ...EDITORIAL_MANAGEMENT],
  ADMIN: ADMIN_PERMISSIONS,
  SUPER_ADMIN: PERMISSIONS,
};

/**
 * What a super admin may add to one person. Account and settings powers are left out,
 * so a grant can never turn someone into a de facto administrator.
 */
export const GRANTABLE_PERMISSIONS = [
  "content.publish",
  "content.editAny",
  "content.archive",
  "topics.manage",
  "relationships.manage",
  "libraries.manage",
  "playlists.manage",
  "youtube.import",
] as const satisfies readonly Permission[];

export type GrantablePermission = (typeof GRANTABLE_PERMISSIONS)[number];

export function isGrantablePermission(value: string): value is GrantablePermission {
  return (GRANTABLE_PERMISSIONS as readonly string[]).includes(value);
}

/** Who is acting. Always built on the server from the database, never from client input. */
export interface Actor {
  id: string;
  email: string;
  role: UserRole;
  permissionGrants: string[];
}

export function hasPermission(actor: Pick<Actor, "role" | "permissionGrants">, permission: Permission): boolean {
  if (ROLE_PERMISSIONS[actor.role].includes(permission)) return true;

  // Stored grants are filtered again here, so a bad database value can't widen access,
  // and a grant has no effect on someone who isn't staff.
  return actor.role !== "USER" && isGrantablePermission(permission) && actor.permissionGrants.includes(permission);
}

/** Every privileged service calls this itself, because hiding UI is not authorization. */
export function assertPermission(actor: Actor | null, permission: Permission): asserts actor is Actor {
  if (!actor) throw new AppError("UNAUTHENTICATED");
  if (!hasPermission(actor, permission)) throw new AppError("FORBIDDEN");
}

export function assertSignedIn(actor: Actor | null): asserts actor is Actor {
  if (!actor) throw new AppError("UNAUTHENTICATED");
}
