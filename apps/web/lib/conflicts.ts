import { Prisma, SessionStatus } from "./generated/prisma/client";
import { prisma } from "./db";

export interface TimeRange {
  startAt: Date;
  endAt: Date;
}

// Statuts pour lesquels une session occupe réellement un créneau (donc sujette aux conflits).
// Typé sur l'enum généré : tout renommage de SessionStatus est répercuté par le compilateur.
const ACTIVE_STATUSES: SessionStatus[] = [
  SessionStatus.proposal,
  SessionStatus.confirmed,
];

/**
 * Vrai si deux créneaux se chevauchent. Bornes en semi-ouvert [start, end) :
 * deux créneaux contigus (fin de l'un = début de l'autre) ne se chevauchent pas.
 * Reproduit la sémantique de l'opérateur && de tstzrange côté Postgres.
 */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/**
 * Renvoie les sessions (statut proposal ou confirmed) dont le créneau chevauche
 * [startAt, endAt), en excluant la session `excludeId` si fournie.
 * Utilise l'index GIST via l'opérateur && de tstzrange.
 *
 * SQL brut justifié (CLAUDE.md §4.2 / ADR-02) : aucun équivalent Prisma pour tstzrange.
 */
export async function findOverlappingSessions(
  startAt: Date,
  endAt: Date,
  excludeId?: string,
): Promise<{ id: string }[]> {
  const exclude = excludeId
    ? Prisma.sql`AND id <> ${excludeId}`
    : Prisma.empty;

  return prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM sessions
    WHERE status::text IN (${Prisma.join(ACTIVE_STATUSES)})
      ${exclude}
      AND tstzrange(start_at, end_at) && tstzrange(${startAt}, ${endAt})
  `);
}
