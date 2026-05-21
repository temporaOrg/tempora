import { Prisma } from "./generated/prisma/client";

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * Montant facturable d'une session : durée (en heures) × taux horaire,
 * arrondi au centime. Calcul en Decimal (jamais en float, cf. CLAUDE.md §3.2)
 * pour la conformité de facturation. Fonction pure.
 */
export function computeBillableAmount(
  startAt: Date,
  endAt: Date,
  hourlyRate: Prisma.Decimal,
): Prisma.Decimal {
  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error("endAt doit être strictement postérieur à startAt");
  }
  if (hourlyRate.isNegative()) {
    throw new Error("hourlyRate ne peut pas être négatif");
  }

  const durationHours = new Prisma.Decimal(
    endAt.getTime() - startAt.getTime(),
  ).div(MS_PER_HOUR);

  return durationHours.mul(hourlyRate).toDecimalPlaces(2);
}
