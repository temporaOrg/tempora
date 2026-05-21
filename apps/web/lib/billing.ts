import { Prisma } from "./generated/prisma/client";

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * Durée d'une session en heures (Decimal, arrondi au centième), exposée à part
 * pour servir de quantité aux lignes de facture. Calcul en Decimal, jamais en
 * float (CLAUDE.md §3.2). Fonction pure.
 */
export function computeDurationHours(
  startAt: Date,
  endAt: Date,
): Prisma.Decimal {
  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error("endAt doit être strictement postérieur à startAt");
  }
  return new Prisma.Decimal(endAt.getTime() - startAt.getTime())
    .div(MS_PER_HOUR)
    .toDecimalPlaces(2);
}

/**
 * Montant facturable d'une session : durée (en heures) × taux horaire,
 * arrondi au centime. Calcul en Decimal (jamais en float, cf. CLAUDE.md §3.2)
 * pour la conformité de facturation. Fonction pure.
 *
 * La durée n'est pas pré-arrondie ici : c'est le montant indicatif affiché sur
 * une session. La ligne de facture, elle, recalcule à partir de la quantité
 * arrondie au centième (cf. service invoices) pour que quantité × prix unitaire
 * réconcilie exactement avec le montant porté au grand livre.
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

  return new Prisma.Decimal(endAt.getTime() - startAt.getTime())
    .div(MS_PER_HOUR)
    .mul(hourlyRate)
    .toDecimalPlaces(2);
}
