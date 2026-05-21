export interface TimeRange {
  startAt: Date;
  endAt: Date;
}

/**
 * Vrai si deux créneaux se chevauchent. Bornes en semi-ouvert [start, end) :
 * deux créneaux contigus (fin de l'un = début de l'autre) ne se chevauchent pas.
 * Reproduit la sémantique de l'opérateur && de tstzrange côté Postgres.
 */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}
