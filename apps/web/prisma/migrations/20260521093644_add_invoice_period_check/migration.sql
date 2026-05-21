-- Cohérence temporelle d'une facture : la fin de période n'est jamais avant le début.
-- (>= car une facture d'une seule journée a period_start = period_end.)
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_period_end_after_start" CHECK ("period_end" >= "period_start");
