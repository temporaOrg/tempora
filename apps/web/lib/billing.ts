/**
 * Montant facturable d'une session : durée (en heures) × taux horaire,
 * arrondi au centime. Fonction pure, testable sans base.
 */
export function computeBillableAmount(
  startAt: Date,
  endAt: Date,
  hourlyRate: number,
): number {
  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error("endAt doit être strictement postérieur à startAt");
  }
  if (hourlyRate < 0) {
    throw new Error("hourlyRate ne peut pas être négatif");
  }

  const durationHours =
    (endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60);
  const amount = durationHours * hourlyRate;
  return Math.round(amount * 100) / 100;
}
