/**
 * Server-side authorization primitives. Every privileged server action calls one
 * of these BEFORE touching the database with the service-role client. UI hiding
 * is cosmetic; these checks (and Postgres RLS) are the real controls.
 */
export type Role = "subscriber" | "admin";

export interface Actor {
  id: string;
  role: Role;
  /** Optional: set true only by the server after verifying the session. */
  suspended?: boolean;
}

export class AuthorizationError extends Error {
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403 = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

export function requireActor(actor: Actor | null | undefined): Actor {
  if (!actor) throw new AuthorizationError("Authentication required", 401);
  if (actor.suspended) throw new AuthorizationError("Account suspended", 403);
  return actor;
}

export function requireAdmin(actor: Actor | null | undefined): Actor {
  const a = requireActor(actor);
  if (a.role !== "admin") throw new AuthorizationError("Administrator access required", 403);
  return a;
}

export function requireOwnerOrAdmin(actor: Actor | null | undefined, ownerId: string): Actor {
  const a = requireActor(actor);
  if (a.role !== "admin" && a.id !== ownerId) throw new AuthorizationError("Not your record", 403);
  return a;
}

/** Winner evidence is visible only to the winner who uploaded it and to admins. */
export function canViewEvidence(actor: Actor | null | undefined, evidenceOwnerId: string): boolean {
  if (!actor || actor.suspended) return false;
  return actor.role === "admin" || actor.id === evidenceOwnerId;
}

/** Storage object keys for evidence are namespaced `<userId>/<claimId>/<file>`; enforce the prefix. */
export function evidencePathBelongsTo(path: string, userId: string): boolean {
  return !path.includes("..") && path.startsWith(`${userId}/`);
}
