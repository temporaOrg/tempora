# Tempora

> Solution self-hosted d'orchestration et de pilotage pour formateurs indépendants multi-écoles.
> Mise en situation de développement — CPI 3-26 DEV — Sup de Vinci 2025/2026.

Tempora absorbe des données hétérogènes (plannings, mails, calendriers, documents) issues d'outils variés, les normalise dans une base pivot PostgreSQL, et restitue au formateur un pilotage unifié de ses prestations — de la planification jusqu'à la facturation conforme (réforme française 2027).

## Architecture en une phrase

Sources (Outlook, Teams, César, Notion, Pennylane) → **n8n** orchestre → **PostgreSQL** (vérité) → **app Next.js** (front + API Routes + Prisma) → **Notion** (restitution lecture seule).

## Stack

- **Front / API** : Next.js 15 (App Router), TypeScript strict, shadcn/ui, Tailwind 4, TanStack Query, Prisma
- **Auth** : Auth.js v5 (Credentials, JWT), Argon2id
- **Données** : PostgreSQL 16 (`tstzrange` pour la détection de conflits)
- **Orchestration** : n8n self-hosted (AI Agent, ingestion, sync)
- **Infra** : Docker Compose sur NAS Synology

## Structure du repo

```
tempora/
├── apps/web/      # Application Next.js (front + API Routes + Prisma)
├── infra/         # docker-compose, reverse proxy
├── n8n/           # Exports JSON des workflows
└── docs/          # Architecture, API, runbook, CLAUDE.md
```

## Démarrage

> À compléter en S2 (setup environnement, Docker, Postgres).

```bash
cp .env.example .env   # puis remplir les valeurs
```

## Conventions

Toutes les règles de développement (TypeScript strict, sécurité, nommage, Git, dates) sont dans **[CLAUDE.md](./CLAUDE.md)** — référence unique du groupe. Toute décision technique structurante y est ajoutée avant implémentation.

- Branche principale `main`, jamais de push direct, PR + 1 review.
- [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- CI bloquante : `tsc --noEmit` + ESLint sur chaque PR.

## Planning

| Séance | Date | Objectif |
|---|---|---|
| S1 | 21 mai 2026 | Cadrage, archi, modèle de données, wireframes |
| S2 | 28 mai 2026 | Setup Docker, Postgres, Auth.js, 1er endpoint |
| S3 | 4 juin 2026 | Workflows n8n (ingestion + conflits) + dashboard |
| S4 | 11 juin 2026 | Facturation Pennylane + page facturation |
| S5 | 18 juin 2026 | Polish, AI Agent, démo |
