# CLAUDE.md — Projet Tempora

> Solution d'orchestration et de pilotage pour formateurs indépendants.
> Mise en situation de développement — CPI 3-26 DEV — Sup de Vinci 2025/2026.

Ce document est la référence unique du groupe. Il décrit la stack, les conventions et les règles de développement. **Toute décision technique structurante doit être ajoutée ici avant d'être implémentée.**

---

## 1. Vision produit

Tempora est une solution self-hosted qui orchestre l'activité d'un formateur indépendant travaillant avec plusieurs écoles. Elle absorbe des données hétérogènes (plannings, mails, calendriers, documents) issues d'outils variés, les normalise dans une base pivot, et restitue au formateur un pilotage unifié de ses prestations, depuis la planification jusqu'à la facturation conforme (réforme française 2027 via Plateforme Agréée).

**Principes directeurs :**

- Souveraineté des données : tout ce qui est ajouté tourne sur le NAS Synology du client.
- Orchestration au centre : n8n est le cerveau événementiel.
- Découplage par couche : chaque outil a une responsabilité unique.
- Évolutivité par construction : remplacer un composant ne casse rien d'autre.

---

## 2. Architecture en couches

| Couche | Composant | Rôle | Hébergement |
|---|---|---|---|
| Sources | Outlook, Teams, César, Notion, Pennylane | Données externes consommées via API ou patterns d'ingestion | SaaS / portails écoles |
| Orchestration | n8n | Workflows événementiels, AI Agent, synchronisations | NAS — Docker |
| Données | PostgreSQL | Source unique de vérité, contraintes métier | NAS — Docker |
| API métier | Next.js API Routes + Prisma | CRUD, validations, requêtes utilisateur | NAS — Docker (même conteneur que le front) |
| Présentation | Front Next.js | Dashboard, résolution conflits, chat IA, déclencheurs | NAS — Docker |
| Restitution passive | Notion | Vue lecture seule du planning final | SaaS, alimenté one-way par n8n |

**Règle d'or de la séparation des responsabilités :**

- n8n orchestre les événements externes (cron, webhooks, sources, sync, IA).
- Le backend Next.js sert les requêtes utilisateur (CRUD, queries, actions).
- Postgres détient la vérité, accessible par les deux selon des zones distinctes.

---

## 3. Stack technique détaillée

### 3.1 Frontend

| Brique | Choix | Version cible | Justification |
|---|---|---|---|
| Framework | Next.js | 15.x (App Router) | Fullstack, déploiement Docker, écosystème mature |
| Langage | TypeScript | 5.x | Typage strict obligatoire |
| UI library | shadcn/ui | dernière | Composants Radix, copy-paste, customisables |
| Styling | Tailwind CSS | 4.x | Stylage utilitaire, cohérence design |
| Icons | Lucide React | dernière | Set complet, tree-shakeable |
| Data fetching | TanStack Query | 5.x | Cache, refetch, états de chargement |
| Forms | React Hook Form + Zod | dernières | Validation schéma typée |
| Charts | Recharts | dernière | Dashboards, graphiques |
| Calendar UI | FullCalendar | 6.x | Vue calendrier sessions |
| Chat UI | Composant custom + SSE | n/a | Streaming depuis n8n |

### 3.2 Backend (API Routes)

| Brique | Choix | Version cible | Justification |
|---|---|---|---|
| Runtime | Next.js API Routes (App Router) | 15.x | Même projet, même langage, même déploiement |
| ORM | Prisma | 5.x | Client TypeScript généré, migrations versionnées, Studio inclus |
| Auth | Auth.js (NextAuth v5) | 5.x | Provider Credentials, JWT, middleware natif |
| Password hashing | argon2 | dernière | Recommandé OWASP en 2026 |
| Validation | Zod | dernière | Schémas partagés front/back |
| Rate limiting | upstash/ratelimit ou middleware custom | dernière | Anti brute-force |
| Date handling | date-fns + date-fns-tz | dernières | Manipulation dates et timezones |
| Logging | pino | dernière | Logs structurés JSON |

### 3.3 Données

| Brique | Choix | Version cible | Justification |
|---|---|---|---|
| SGBD | PostgreSQL | 16.x | Mature, gère tstzrange pour détection chevauchements |
| Admin DB (secours) | Adminer ou pgAdmin | dernière | Accès manuel ponctuel |
| Backups | pg_dump cron + Synology Hyper Backup | n/a | Double sauvegarde locale et externe |

### 3.4 Orchestration

| Brique | Choix | Version cible | Justification |
|---|---|---|---|
| Orchestrateur | n8n self-hosted | dernière stable | LangChain, AI Agent, nœuds natifs Notion/Outlook/Teams/Pennylane |
| LLM (chat et parsing) | API Anthropic Claude ou OpenAI | dernière | API cloud par défaut, Ollama local en évolution |
| Scraping headless | n8n-nodes-puppeteer | dernière | Pour portails sans API (César et autres) |

### 3.5 Intégrations externes

| Service | API | Mode d'accès |
|---|---|---|
| Pennylane | REST V2 | OAuth 2.0 ou developer token, scopes granulaires |
| Outlook / Microsoft Graph | REST | OAuth 2.0 via Azure AD |
| Microsoft Teams | REST | Même tenant Microsoft Graph |
| Notion | REST | Integration token |
| Pappers / INSEE Sirene | REST | Clé API publique |

### 3.6 Infrastructure

| Brique | Choix | Justification |
|---|---|---|
| Hôte | NAS Synology client | Souveraineté, existant chez le client |
| Conteneurisation | Docker + Docker Compose | Déjà installé sur le NAS |
| Reverse proxy | Synology natif (nginx-like) | HTTPS Let's Encrypt automatique |
| Accès distant | QuickConnect Synology ou DDNS Synology | Natif, sans config DNS externe |
| CI / CD | GitHub Actions (optionnel) | Build images Docker, push registry |

---

## 4. Règles de développement

### 4.1 Qualité de code TypeScript

- `strict: true` dans `tsconfig.json`, **non négociable**. Inclut `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`.
- **Jamais de `any`.** Si un type est inconnu, utiliser `unknown` et narrow avec un type guard. L'usage de `any` doit être justifié en commentaire et reviewé.
- **Jamais de `@ts-ignore` ni `@ts-expect-error`** sauf cas exceptionnel documenté.
- **Toute valeur potentiellement nulle est typée comme telle.** Pas de `!` (non-null assertion) sans justification.
- Préférer les types unions discriminés aux booléens multiples (`type Status = 'pending' | 'confirmed' | 'cancelled'` plutôt que `isPending`, `isConfirmed`).
- Tout I/O externe (API, DB, fichier) doit être validé par **Zod** avant utilisation. Ne jamais faire confiance à la donnée entrante.

### 4.2 Sécurité — règles strictes

- **HTTPS obligatoire partout.** Aucun appel HTTP en production. En dev local, autorisé sur `localhost` uniquement.
- **Secrets dans `.env`.** Jamais commités. Un fichier `.env.example` documente les variables sans valeurs.
- **Mots de passe hashés en Argon2id.** Jamais bcrypt en nouveau code, jamais MD5/SHA1 nulle part.
- **Cookies de session : `httpOnly`, `secure`, `sameSite: 'lax'`** par défaut.
- **CSRF protection automatique** via Auth.js sur toutes les mutations.
- **Headers de sécurité** dans `next.config.js` : `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Middleware deny-by-default** : toutes les routes sont protégées par défaut, exceptions explicites uniquement (`/api/auth/*`, `/login`).
- **Rate limiting** sur `/api/auth/*` : 5 tentatives par 15 minutes par IP.
- **Validation Zod systématique** sur tous les inputs API.
- **Pas de SQL brut** sauf cas exceptionnel justifié. Tout passe par Prisma.
- **Pas de log de PII** (mots de passe, tokens, données clients sensibles). Filtre de logger obligatoire.
- **Audit log** pour toute mutation métier critique (création, modification, suppression session, facture, résolution conflit).

### 4.3 Authentification

- Système mono-utilisateur (admin unique seedé au déploiement).
- Credentials stockés en variables d'environnement : `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` (Argon2id).
- Auth.js avec provider Credentials, stratégie JWT.
- Évolution future possible vers table `users` sans réécriture, juste migration du provider.
- Pas d'inscription publique, pas de récupération de mot de passe automatisée (réinitialisation manuelle via SSH au NAS).

### 4.4 Conventions de nommage

| Élément | Convention | Exemple |
|---|---|---|
| Fichiers TS | `kebab-case` | `session-detail.tsx` |
| Composants React | `PascalCase` | `SessionDetail` |
| Hooks | `camelCase` préfixé `use` | `useSessions` |
| Fonctions et variables | `camelCase` | `getSessionById` |
| Constantes globales | `SCREAMING_SNAKE_CASE` | `MAX_SESSIONS_PER_PAGE` |
| Tables SQL | `snake_case` au pluriel | `sessions_proposals` |
| Colonnes SQL | `snake_case` | `start_at` |
| Routes API | `kebab-case` | `/api/sessions-proposals` |
| Types et interfaces | `PascalCase` | `SessionWithSchool` |
| Branches Git | `kebab-case` préfixé | `feat/conflict-resolution`, `fix/timezone-bug` |

### 4.5 Git

- Branche principale : `main`. **Jamais de push direct.**
- Branches de feature : `feat/<sujet>`, `fix/<sujet>`, `chore/<sujet>`, `docs/<sujet>`.
- Commits : convention **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- Une PR = une fonctionnalité. Pas de PR « fourre-tout ».
- Revue par au moins un autre membre du groupe avant merge.
- Squash merge par défaut, l'historique de `main` reste lisible.

### 4.6 Tests

- Pas d'obligation de couverture pour ce projet de 5 séances, mais les fonctions métier critiques doivent avoir au moins un test unitaire :
  - Détection de conflit (logique `overlap` via `tstzrange`)
  - Calcul de montant facturable (durée × taux)
  - Normalisation LLM des inputs ingérés
- Stack de test : **Vitest** + **React Testing Library**.

### 4.7 Code review et qualité

- **ESLint** : config Next.js officielle + règles strictes TypeScript.
- **Prettier** : formattage automatique au commit via `lint-staged` et `husky`.
- **TypeScript strict** : aucun build avec une erreur de type. CI bloque le merge.
- Toute fonction exportée doit être typée explicitement (paramètres et retour).
- Composants React : props typées en interface, jamais en inline.

### 4.8 Design system

- Utilisation exclusive de **shadcn/ui** pour les composants de base.
- Pas de CSS custom hors Tailwind, sauf cas exceptionnel (animation complexe).
- Palette de couleurs définie dans `tailwind.config.ts`, **pas d'hexa en dur** dans les composants.
- Cohérence visuelle obligatoire : densité d'information, espacements, typographie standardisée via les tokens Tailwind.
- Mode clair et mode sombre supportés par défaut.
- Responsive obligatoire : utilisable sur mobile (le formateur consulte son téléphone), pas seulement desktop.
- Pas d'emoji dans l'interface, icônes Lucide uniquement.

### 4.9 Gestion des dates et fuseaux

- Toutes les dates en base sont stockées en `TIMESTAMPTZ` (UTC).
- L'affichage front se fait dans le fuseau du formateur (`Europe/Paris` par défaut), via `date-fns-tz`.
- Aucune date sous forme de string libre dans le code, toujours `Date` ou objet Temporal le cas échéant.
- Les ranges de sessions utilisent `tstzrange` côté Postgres pour les requêtes d'overlap.

### 4.10 Logs et observabilité

- Logger structuré JSON via **pino**.
- Niveaux : `error`, `warn`, `info`, `debug`. Production limitée à `info` et plus.
- Tout appel d'API externe loggé avec durée, statut, sans le contenu sensible.
- Erreurs non gérées remontent vers un fichier dédié sur le NAS.
- Pas de Sentry ou autre SaaS externe pour rester souverain.

---

## 5. Structure du repo

```
tempora/
├── apps/
│   └── web/                          # Application Next.js (front + API Routes)
│       ├── app/
│       │   ├── (auth)/login/         # Pages publiques
│       │   ├── (app)/                # Pages protégées
│       │   │   ├── dashboard/
│       │   │   ├── sessions/
│       │   │   ├── conflicts/
│       │   │   ├── invoices/
│       │   │   └── chat/
│       │   └── api/                  # Backend API Routes
│       │       ├── auth/[...nextauth]/
│       │       ├── sessions/
│       │       ├── conflicts/
│       │       ├── schools/
│       │       ├── invoices/
│       │       └── dashboard/
│       ├── components/               # Composants partagés
│       ├── lib/
│       │   ├── db.ts                 # Client Prisma
│       │   ├── auth.ts               # Config Auth.js
│       │   ├── n8n.ts                # Client webhooks n8n
│       │   └── validators/           # Schémas Zod
│       ├── prisma/
│       │   ├── schema.prisma         # Modèle de données
│       │   ├── migrations/           # Migrations versionnées
│       │   └── seed.ts               # Seed admin
│       ├── middleware.ts             # Auth deny-by-default
│       └── tests/
├── infra/
│   ├── docker-compose.yml            # Stack complète (postgres, n8n, web)
│   ├── docker-compose.prod.yml       # Override production
│   └── nginx/                        # Config reverse proxy si custom
├── n8n/
│   ├── workflows/                    # Exports JSON des workflows
│   └── README.md                     # Doc des workflows
├── docs/
│   ├── CLAUDE.md                     # Ce fichier
│   ├── architecture.md               # Schémas détaillés
│   ├── api.md                        # Doc des endpoints
│   └── runbook.md                    # Procédures opérationnelles
├── .env.example
├── .gitignore
└── README.md
```

---

## 6. Variables d'environnement

Le fichier `.env.example` doit contenir toutes les variables, sans valeurs sensibles.

```env
# Base de données
DATABASE_URL="postgresql://tempora:CHANGE_ME@postgres:5432/tempora"

# Authentification
AUTH_SECRET="GENERATE_WITH_openssl_rand_base64_32"
NEXTAUTH_URL="https://app.formateur.synology.me"
ADMIN_EMAIL="formateur@example.com"
ADMIN_PASSWORD_HASH="GENERATE_WITH_argon2_HASH_SCRIPT"

# n8n
N8N_WEBHOOK_BASE_URL="http://n8n:5678/webhook"
N8N_API_KEY="CHANGE_ME"

# Intégrations externes
PENNYLANE_API_TOKEN="CHANGE_ME"
NOTION_INTEGRATION_TOKEN="CHANGE_ME"
MICROSOFT_GRAPH_CLIENT_ID="CHANGE_ME"
MICROSOFT_GRAPH_CLIENT_SECRET="CHANGE_ME"
MICROSOFT_GRAPH_TENANT_ID="CHANGE_ME"

# LLM (pour l'AI Agent dans n8n)
ANTHROPIC_API_KEY="CHANGE_ME"
# ou
OPENAI_API_KEY="CHANGE_ME"

# Application
NODE_ENV="production"
LOG_LEVEL="info"
TZ="Europe/Paris"
```

---

## 7. Choix d'architecture validés (ADR light)

### ADR-01 — Pourquoi Pennylane et pas Indy

Indy ne propose pas d'API publique pour les développeurs. Notre architecture repose entièrement sur l'orchestration via API. Pennylane est une Plateforme Agréée DGFiP avec une API REST V2 moderne, des scopes granulaires, et un template n8n officiel. Coût similaire à Indy (14 €/mois Basic), conformité 2027 native.

### ADR-02 — Pourquoi Postgres et pas une DB embarquée dans n8n

n8n n'est pas un SGBD. La détection de conflits (chevauchements horaires) nécessite un opérateur `tstzrange && tstzrange` qu'aucun outil low-code ne fournit. Postgres garantit ACID, contraintes référentielles et audit_log propre. Postgres est aussi requis par Prisma et Auth.js.

### ADR-03 — Pourquoi un backend Next.js séparé de n8n

n8n orchestre les événements externes (cron, webhooks, sync). Le backend sert les requêtes utilisateur (CRUD, queries). Mélanger les deux dans n8n créerait un bordel ingérable. Next.js API Routes permet de garder front et back dans le même projet, même langage, même déploiement.

### ADR-04 — Pourquoi Notion en lecture seule

L'API Notion n'a pas de gestion native des conflits, de contraintes d'unicité, ni de transactions. Lui demander d'être source de vérité créerait des doublons et des corruptions. Notion devient une vue lecture, alimentée one-way depuis Postgres, dans l'outil familier du formateur.

### ADR-05 — Pourquoi un système d'ingestion générique multi-sources

Le sujet mentionne César, Outlook et Teams comme exemples, pas comme contraintes. Une intégration spécifique à César serait fragile (portail propriétaire, robots.txt, pas d'API publique). Une couche d'absorption générique (5 patterns : iCal, mail, scraping, CSV, Outlook miroir) absorbe n'importe quelle école présente ou future.

### ADR-06 — Pourquoi self-hosted sur le NAS du client

Le client a déjà un NAS Synology avec Docker. Hébergement gratuit, données sous son contrôle, accès distant natif via QuickConnect ou DDNS, HTTPS Let's Encrypt automatique. Aucun argument pour un hébergement cloud externe dans ce contexte.

---

## 8. Workflow de développement par séance

| Séance | Date | Objectif principal | Livrable |
|---|---|---|---|
| S1 | 21 mai 2026 | Cadrage, archi, modèle de données pivot, wireframes front | Doc archi + schéma DB Prisma + maquettes |
| S2 | 28 mai 2026 | Setup environnement, Docker, Postgres, Auth.js, premier endpoint API | Stack opérationnelle, 1 vue front qui lit Postgres via API |
| S3 | 4 juin 2026 | Workflows n8n (ingestion + détection conflits) + dashboard front | Boucle « source → DB → vue » qui tourne |
| S4 | 11 juin 2026 | Workflow facturation Pennylane + page facturation front | Boucle métier complète déclenchable depuis le front |
| S5 | 18 juin 2026 | Polish, AI Agent intégré au chat, préparation démo 20 min | Démo prête, slides, runbook |

---

## 9. Critères de qualité avant chaque merge

- [ ] Aucune erreur TypeScript (`tsc --noEmit`)
- [ ] Aucun warning ESLint
- [ ] Tests unitaires verts (si concernés)
- [ ] Validation Zod en place sur tout I/O externe
- [ ] Pas de `any` introduit sans justification
- [ ] Pas de secret commité (`git secrets` ou équivalent)
- [ ] Routes API protégées par défaut (vérifier matcher middleware)
- [ ] Doc à jour si décision structurante (ADR ajouté dans ce fichier)

---

## 10. Glossaire

- **PA (Plateforme Agréée)** : opérateur immatriculé par la DGFiP pour la facturation électronique B2B en France (anciennement PDP).
- **Session** : un cours dispensé par le formateur (date, école, classe, durée, taux).
- **Proposal** : une session candidate, encore en zone tampon avant validation.
- **Conflit** : deux ou plusieurs proposals qui se chevauchent dans le temps.
- **Source** : origine d'une donnée ingérée (`outlook`, `email`, `csv`, `ical`, `scraper`).
- **AI Agent** : composant LangChain dans n8n qui répond aux questions du formateur en mobilisant les tools métier.
- **Tool (au sens AI Agent)** : fonction exposée à l'agent (lister sessions, créer facture, etc.).

---

## 11. Contacts et accès

À compléter par l'équipe : qui est responsable de quoi, quels comptes test sont créés, quelles credentials sont partagées et comment.
