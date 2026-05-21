import { prisma } from "./db";
import { Prisma } from "./generated/prisma/client";

/**
 * Journal d'audit des mutations métier critiques (CLAUDE.md §4.2).
 *
 * Toute création / modification / suppression / résolution / émission doit
 * être tracée. `action` reste un texte (pas un enum Postgres) pour pouvoir
 * s'enrichir sans migration ; le type ci-dessous le contraint côté applicatif.
 */
export type AuditAction =
  | "create"
  | "update"
  | "archive"
  | "delete"
  | "resolve_conflict"
  | "issue_invoice";

export interface RecordAuditInput {
  readonly actor: string;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  /** État avant mutation (objet domaine ; sérialisé en JSON sûr). */
  readonly before?: unknown;
  /** État après mutation (objet domaine ; sérialisé en JSON sûr). */
  readonly after?: unknown;
}

/**
 * Convertit un objet domaine (pouvant contenir Date / Prisma.Decimal) en JSON
 * stockable en `jsonb`. Date → ISO, Decimal → string via leurs `toJSON`.
 * `undefined` reste absent ; `null` est conservé.
 */
function toJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actor: input.actor,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: toJsonValue(input.before),
      after: toJsonValue(input.after),
    },
  });
}
