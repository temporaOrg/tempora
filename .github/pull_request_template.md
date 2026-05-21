## Objectif

<!-- Que fait cette PR, et pourquoi ? Une PR = une fonctionnalité (cf. §4.5). -->

## Type

- [ ] feat
- [ ] fix
- [ ] chore
- [ ] docs
- [ ] refactor
- [ ] test

## Checklist avant merge (cf. CLAUDE.md §9)

- [ ] Aucune erreur TypeScript (`tsc --noEmit`)
- [ ] Aucun warning ESLint
- [ ] Tests unitaires verts (si concernés)
- [ ] Validation Zod en place sur tout I/O externe
- [ ] Pas de `any` introduit sans justification
- [ ] Pas de secret commité
- [ ] Routes API protégées par défaut (matcher middleware vérifié)
- [ ] Doc à jour si décision structurante (ADR ajouté dans CLAUDE.md)

## Notes pour le reviewer

<!-- Points d'attention, choix discutables, captures d'écran si UI. -->
