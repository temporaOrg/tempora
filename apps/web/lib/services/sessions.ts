import { prisma } from "../db";
import { Prisma, type Session } from "../generated/prisma/client";
import { NotFoundError, ValidationError } from "../api/errors";
import { recordAudit } from "../audit";
import { computeBillableAmount } from "../billing";
import { findOverlappingSessions } from "../conflicts";
import { buildPaginationMeta } from "../validators/common";
import type { PaginationMeta } from "../api/response";
import type {
  SessionCreateInput,
  SessionListQuery,
  SessionResponse,
  SessionUpdateInput,
} from "../validators/sessions";

/**
 * Logique métier de la ressource `sessions`. Les routes ne font qu'appeler ces
 * fonctions ; héritage du taux, validation des bornes, détection de conflit et
 * audit vivent ici (testable sans HTTP).
 */

const ENTITY_TYPE = "session";

/** Mappe une entité Prisma vers la forme JSON exposée (Decimal → string, dates → ISO). */
function toResponse(session: Session): SessionResponse {
  return {
    id: session.id,
    schoolId: session.schoolId,
    title: session.title,
    classe: session.classe,
    startAt: session.startAt.toISOString(),
    endAt: session.endAt.toISOString(),
    hourlyRate: session.hourlyRate.toFixed(2),
    billableAmount: computeBillableAmount(
      session.startAt,
      session.endAt,
      session.hourlyRate,
    ).toFixed(2),
    status: session.status,
    location: session.location,
    source: session.source,
    ingestionId: session.ingestionId,
    invoiceId: session.invoiceId,
    notes: session.notes,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

/** Garantit la cohérence des bornes : fin strictement après début. */
function assertChronology(startAt: Date, endAt: Date): void {
  if (endAt <= startAt) {
    throw new ValidationError("Dates incohérentes.", [
      {
        path: "endAt",
        message: "La date de fin doit être postérieure à la date de début.",
      },
    ]);
  }
}

export async function createSession(
  input: SessionCreateInput,
  actor: string,
): Promise<SessionResponse> {
  assertChronology(input.startAt, input.endAt);

  return prisma.$transaction(async (tx) => {
    const school = await tx.school.findUnique({
      where: { id: input.schoolId },
    });
    if (!school) {
      throw new NotFoundError("École introuvable.");
    }

    // Héritage du taux : explicite s'il est fourni, sinon le taux par défaut de l'école.
    const rate =
      input.hourlyRate !== undefined
        ? new Prisma.Decimal(input.hourlyRate)
        : school.defaultHourlyRate;
    if (rate === null) {
      throw new ValidationError("Taux horaire requis.", [
        {
          path: "hourlyRate",
          message:
            "Aucun taux fourni et l'école n'a pas de taux horaire par défaut.",
        },
      ]);
    }

    const session = await tx.session.create({
      data: {
        schoolId: input.schoolId,
        title: input.title,
        classe: input.classe ?? null,
        startAt: input.startAt,
        endAt: input.endAt,
        hourlyRate: rate,
        status: input.status, // undefined → @default(proposal)
        location: input.location ?? null,
        source: input.source, // undefined → @default(manual)
        notes: input.notes ?? null,
      },
    });

    const dto = toResponse(session);
    await recordAudit(
      { actor, action: "create", entityType: ENTITY_TYPE, entityId: session.id, after: dto },
      tx,
    );
    return dto;
  });
}

export async function listSessions(query: SessionListQuery): Promise<{
  data: SessionResponse[];
  pagination: PaginationMeta;
}> {
  const startAtFilter: Prisma.DateTimeFilter = {};
  if (query.from) startAtFilter.gte = query.from;
  if (query.to) startAtFilter.lt = query.to;

  const where: Prisma.SessionWhereInput = {
    ...(query.schoolId ? { schoolId: query.schoolId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to ? { startAt: startAtFilter } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.session.findMany({
      where,
      orderBy: { startAt: "asc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.session.count({ where }),
  ]);

  return {
    data: rows.map(toResponse),
    pagination: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function getSession(id: string): Promise<SessionResponse> {
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) {
    throw new NotFoundError("Session introuvable.");
  }
  return toResponse(session);
}

export async function updateSession(
  id: string,
  input: SessionUpdateInput,
  actor: string,
): Promise<SessionResponse> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.session.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError("Session introuvable.");
    }

    // Bornes résultantes après application partielle, validées avant écriture.
    const startAt = input.startAt ?? existing.startAt;
    const endAt = input.endAt ?? existing.endAt;
    assertChronology(startAt, endAt);

    const updated = await tx.session.update({
      where: { id },
      data: {
        title: input.title,
        classe: input.classe,
        startAt: input.startAt,
        endAt: input.endAt,
        hourlyRate:
          input.hourlyRate === undefined
            ? undefined
            : new Prisma.Decimal(input.hourlyRate),
        status: input.status,
        location: input.location,
        source: input.source,
        notes: input.notes,
      },
    });

    const dto = toResponse(updated);
    await recordAudit(
      {
        actor,
        action: "update",
        entityType: ENTITY_TYPE,
        entityId: id,
        before: toResponse(existing),
        after: dto,
      },
      tx,
    );
    return dto;
  });
}

/**
 * Annulation : on passe le statut à `cancelled` plutôt que supprimer la ligne
 * (exigence d'audit, comme l'archivage des écoles). Idempotent.
 */
export async function cancelSession(id: string, actor: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.session.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError("Session introuvable.");
    }
    if (existing.status === "cancelled") return; // idempotent

    const updated = await tx.session.update({
      where: { id },
      data: { status: "cancelled" },
    });
    await recordAudit(
      {
        actor,
        action: "update",
        entityType: ENTITY_TYPE,
        entityId: id,
        before: toResponse(existing),
        after: toResponse(updated),
      },
      tx,
    );
  });
}

/**
 * Sessions actives (proposal/confirmed) chevauchant le créneau de `id`,
 * via l'index GIST `tstzrange`. La session elle-même est exclue.
 */
export async function detectConflicts(id: string): Promise<SessionResponse[]> {
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) {
    throw new NotFoundError("Session introuvable.");
  }

  const overlapping = await findOverlappingSessions(
    session.startAt,
    session.endAt,
    session.id,
  );
  if (overlapping.length === 0) return [];

  const rows = await prisma.session.findMany({
    where: { id: { in: overlapping.map((o) => o.id) } },
    orderBy: { startAt: "asc" },
  });
  return rows.map(toResponse);
}
