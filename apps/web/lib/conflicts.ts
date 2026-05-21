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

/** Une paire (non ordonnée) de sessions actives dont les créneaux se chevauchent. */
export interface OverlappingPair {
  aId: string;
  bId: string;
}

/**
 * Renvoie toutes les paires de sessions actives (proposal/confirmed) qui se
 * chevauchent, dans l'ensemble de la base. La condition `a.id < b.id` garantit
 * que chaque paire n'apparaît qu'une fois (et écarte l'auto-appariement).
 *
 * Sert à matérialiser les conflits (table `conflicts`) : une vue globale, là où
 * findOverlappingSessions raisonne autour d'une seule session.
 *
 * SQL brut justifié (CLAUDE.md §4.2 / ADR-02) : aucun équivalent Prisma pour
 * l'auto-jointure sur l'opérateur && de tstzrange.
 */
export async function findOverlappingPairs(): Promise<OverlappingPair[]> {
  return prisma.$queryRaw<OverlappingPair[]>(Prisma.sql`
    SELECT a.id AS "aId", b.id AS "bId"
    FROM sessions a
    JOIN sessions b ON a.id < b.id
    WHERE a.status::text IN (${Prisma.join(ACTIVE_STATUSES)})
      AND b.status::text IN (${Prisma.join(ACTIVE_STATUSES)})
      AND tstzrange(a.start_at, a.end_at) && tstzrange(b.start_at, b.end_at)
  `);
}
