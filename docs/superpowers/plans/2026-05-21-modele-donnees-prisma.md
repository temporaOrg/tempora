# Modèle de données Prisma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en place la base pivot PostgreSQL de Tempora via Prisma — schéma des 7 entités, migration avec index GIST pour la détection de conflits, seed, et tests des fonctions métier critiques (calcul de montant facturable, détection de chevauchement).

**Architecture:** Application Next.js dans `apps/web` (scaffold minimal). Prisma gère le schéma et les migrations versionnées. La détection de chevauchement utilise un **index GIST sur l'expression `tstzrange(start_at, end_at)`** (pas de colonne générée — voir note ci-dessous) et une requête `&&` en `$queryRaw` typé. Les fonctions pures (montant, overlap) sont testées sans base ; la requête de conflit est testée en intégration contre un Postgres de dev lancé en Docker.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Prisma 5, PostgreSQL 16, Vitest, tsx, Docker Compose (dev).

> **Note d'implémentation vs spec** : le spec décrit un champ `period tstzrange`. On le réalise comme un **index GIST sur l'expression** `tstzrange(start_at, end_at)` plutôt qu'une colonne générée stockée. Raison : même performance pour l'opérateur `&&`, mais zéro colonne `Unsupported` à gérer dans Prisma (évite les faux « drifts » à chaque `migrate`). L'intention du spec (overlap rapide via tstzrange + GIST) est pleinement respectée.

> **Branche** : exécuter ce plan sur une branche dédiée `feat/prisma-data-model` créée depuis `main`. Jamais sur `main` (cf. mémoire projet).

---

## File Structure

```
infra/
  docker-compose.dev.yml        # Postgres 16 local pour dev + tests (Iliès, provisoire)
apps/web/
  package.json                  # scaffold Next.js + deps Prisma/Vitest
  tsconfig.json                 # strict: true
  .env                          # DATABASE_URL local (gitignored)
  .env.example                  # déjà présent à la racine ; ajout d'un exemple local si besoin
  prisma/
    schema.prisma               # 7 modèles + 5 enums
    migrations/                 # migration initiale (générée) + SQL custom (CHECK + GIST)
    seed.ts                     # seed admin-less : 2 écoles + sessions de démo
  lib/
    db.ts                       # singleton PrismaClient
    billing.ts                  # computeBillableAmount (pure)
    conflicts.ts                # overlaps (pure) + findOverlappingSessions (DB, $queryRaw)
  vitest.config.ts
  vitest.setup.ts               # charge .env pour les tests d'intégration
  tests/
    billing.test.ts             # unitaire pur
    overlaps.test.ts            # unitaire pur
    conflicts.integration.test.ts  # contre Postgres
```

---

## Task 1: Postgres de dev en Docker

**Files:**
- Create: `infra/docker-compose.dev.yml`

- [ ] **Step 1: Écrire le compose de dev**

Create `infra/docker-compose.dev.yml`:

```yaml
# Postgres local pour développement et tests de apps/web.
# Provisoire (porté par Iliès) — l'équipe infra le fusionnera dans la stack complète.
services:
  postgres:
    image: postgres:16-alpine
    container_name: tempora-postgres-dev
    restart: unless-stopped
    environment:
      POSTGRES_USER: tempora
      POSTGRES_PASSWORD: tempora_dev
      POSTGRES_DB: tempora
    ports:
      - "5432:5432"
    volumes:
      - tempora_pg_dev:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tempora -d tempora"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  tempora_pg_dev:
```

- [ ] **Step 2: Démarrer Postgres et vérifier**

Run: `docker compose -f infra/docker-compose.dev.yml up -d && sleep 5 && docker exec tempora-postgres-dev pg_isready -U tempora -d tempora`
Expected: `... accepting connections`

- [ ] **Step 3: Commit**

```bash
git add infra/docker-compose.dev.yml
git commit -m "chore(infra): postgres 16 local pour dev et tests"
```

---

## Task 2: Scaffold Next.js + tsconfig strict

**Files:**
- Create: `apps/web/*` (généré par create-next-app)
- Modify: `apps/web/tsconfig.json`

- [ ] **Step 1: Supprimer le placeholder et scaffolder**

Run:
```bash
rm -f apps/web/.gitkeep
npx create-next-app@latest apps/web \
  --typescript --eslint --app --tailwind \
  --src-dir=false --import-alias "@/*" --use-npm --no-turbopack --yes
```
Expected: projet Next.js créé dans `apps/web`, `package.json` présent.

- [ ] **Step 2: Forcer le mode strict TypeScript**

Vérifier que `apps/web/tsconfig.json` contient `"strict": true` dans `compilerOptions` (create-next-app l'active par défaut). Ajouter aussi `"noUncheckedIndexedAccess": true` pour durcir (conforme §4.1).

```jsonc
// apps/web/tsconfig.json — compilerOptions (extrait à garantir)
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
    // ... reste généré par Next.js inchangé
  }
}
```

- [ ] **Step 3: Vérifier le typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: aucune erreur (exit 0).

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "chore(web): scaffold Next.js 15 + TypeScript strict"
```

---

## Task 3: Installer Prisma, Vitest, et le client DB

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/.env`, `apps/web/lib/db.ts`, `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts`

- [ ] **Step 1: Installer les dépendances**

Run:
```bash
cd apps/web
npm install @prisma/client
npm install -D prisma vitest tsx dotenv @types/node
```

- [ ] **Step 2: Initialiser Prisma**

Run: `cd apps/web && npx prisma init --datasource-provider postgresql`
Expected: crée `apps/web/prisma/schema.prisma` et ajoute `DATABASE_URL` au `.env`.

- [ ] **Step 3: Écrire le `.env` local**

Create/overwrite `apps/web/.env`:

```env
DATABASE_URL="postgresql://tempora:tempora_dev@localhost:5432/tempora?schema=public"
```

Vérifier que `apps/web/.env` est bien ignoré par le `.gitignore` racine (la règle `.env` le couvre).

- [ ] **Step 4: Créer le singleton Prisma**

Create `apps/web/lib/db.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 5: Configurer Vitest**

Create `apps/web/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
```

Create `apps/web/vitest.setup.ts`:

```typescript
import { config } from "dotenv";

// Charge DATABASE_URL pour les tests d'intégration.
config({ path: ".env" });
```

- [ ] **Step 6: Ajouter les scripts npm**

Modify `apps/web/package.json` — ajouter dans `"scripts"` :

```jsonc
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "db:seed": "tsx prisma/seed.ts",
    "db:migrate": "prisma migrate dev"
  }
}
```

Et ajouter le bloc `prisma.seed` au même niveau que `scripts` :

```jsonc
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/lib/db.ts apps/web/vitest.config.ts apps/web/vitest.setup.ts apps/web/prisma/schema.prisma
git commit -m "chore(web): prisma + vitest + client db singleton"
```

---

## Task 4: Écrire le schéma Prisma

**Files:**
- Modify: `apps/web/prisma/schema.prisma`

- [ ] **Step 1: Écrire le schéma complet**

Overwrite `apps/web/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum SessionStatus {
  proposal
  confirmed
  cancelled
  invoiced

  @@map("session_status")
}

enum SourceType {
  outlook
  email
  csv
  ical
  scraper
  manual

  @@map("source_type")
}

enum IngestionStatus {
  pending
  normalized
  failed
  ignored

  @@map("ingestion_status")
}

enum ConflictStatus {
  open
  resolved
  ignored

  @@map("conflict_status")
}

enum InvoiceStatus {
  draft
  issued
  sent
  paid
  cancelled

  @@map("invoice_status")
}

model School {
  id                String    @id @default(cuid())
  name              String
  siret             String?
  vatNumber         String?   @map("vat_number")
  addressLine       String?   @map("address_line")
  postalCode        String?   @map("postal_code")
  city              String?
  country           String    @default("FR")
  billingEmail      String?   @map("billing_email")
  defaultHourlyRate Decimal?  @map("default_hourly_rate") @db.Decimal(10, 2)
  color             String?
  isArchived        Boolean   @default(false) @map("is_archived")
  createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  sessions Session[]
  invoices Invoice[]

  @@map("schools")
}

model Session {
  id          String        @id @default(cuid())
  schoolId    String        @map("school_id")
  title       String
  classe      String?
  startAt     DateTime      @map("start_at") @db.Timestamptz(6)
  endAt       DateTime      @map("end_at") @db.Timestamptz(6)
  hourlyRate  Decimal       @map("hourly_rate") @db.Decimal(10, 2)
  status      SessionStatus @default(proposal)
  location    String?
  source      SourceType    @default(manual)
  ingestionId String?       @map("ingestion_id")
  invoiceId   String?       @map("invoice_id")
  notes       String?
  createdAt   DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  school           School             @relation(fields: [schoolId], references: [id])
  ingestion        Ingestion?         @relation(fields: [ingestionId], references: [id])
  invoice          Invoice?           @relation(fields: [invoiceId], references: [id])
  conflictSessions ConflictSession[]

  @@index([schoolId])
  @@index([status])
  @@index([startAt])
  @@map("sessions")
}

model Ingestion {
  id          String          @id @default(cuid())
  source      SourceType
  externalId  String?         @map("external_id")
  rawPayload  Json            @map("raw_payload")
  status      IngestionStatus @default(pending)
  error       String?
  receivedAt  DateTime        @default(now()) @map("received_at") @db.Timestamptz(6)
  processedAt DateTime?       @map("processed_at") @db.Timestamptz(6)
  createdAt   DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime        @updatedAt @map("updated_at") @db.Timestamptz(6)

  sessions Session[]

  @@index([status])
  @@index([externalId])
  @@map("ingestions")
}

model Conflict {
  id             String         @id @default(cuid())
  status         ConflictStatus @default(open)
  detectedAt     DateTime       @default(now()) @map("detected_at") @db.Timestamptz(6)
  resolvedAt     DateTime?      @map("resolved_at") @db.Timestamptz(6)
  resolutionNote String?        @map("resolution_note")
  createdAt      DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime       @updatedAt @map("updated_at") @db.Timestamptz(6)

  conflictSessions ConflictSession[]

  @@index([status])
  @@map("conflicts")
}

model ConflictSession {
  conflictId String @map("conflict_id")
  sessionId  String @map("session_id")

  conflict Conflict @relation(fields: [conflictId], references: [id], onDelete: Cascade)
  session  Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@id([conflictId, sessionId])
  @@map("conflict_sessions")
}

model Invoice {
  id          String        @id @default(cuid())
  schoolId    String        @map("school_id")
  number      String?
  status      InvoiceStatus @default(draft)
  periodStart DateTime      @map("period_start") @db.Date
  periodEnd   DateTime      @map("period_end") @db.Date
  currency    String        @default("EUR")
  subtotal    Decimal       @default(0) @db.Decimal(10, 2)
  taxAmount   Decimal       @default(0) @map("tax_amount") @db.Decimal(10, 2)
  total       Decimal       @default(0) @db.Decimal(10, 2)
  pennylaneId String?       @map("pennylane_id")
  issuedAt    DateTime?     @map("issued_at") @db.Timestamptz(6)
  dueAt       DateTime?     @map("due_at") @db.Timestamptz(6)
  paidAt      DateTime?     @map("paid_at") @db.Timestamptz(6)
  createdAt   DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  school   School        @relation(fields: [schoolId], references: [id])
  sessions Session[]
  lines    InvoiceLine[]

  @@index([schoolId])
  @@index([status])
  @@map("invoices")
}

model InvoiceLine {
  id        String   @id @default(cuid())
  invoiceId String   @map("invoice_id")
  sessionId String?  @map("session_id")
  label     String
  quantity  Decimal  @db.Decimal(10, 2)
  unitPrice Decimal  @map("unit_price") @db.Decimal(10, 2)
  amount    Decimal  @db.Decimal(10, 2)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  invoice Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@map("invoice_lines")
}

model AuditLog {
  id         String   @id @default(cuid())
  actor      String
  action     String
  entityType String   @map("entity_type")
  entityId   String   @map("entity_id")
  before     Json?
  after      Json?
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([entityType, entityId])
  @@map("audit_logs")
}
```

- [ ] **Step 2: Valider le format et la cohérence du schéma**

Run: `cd apps/web && npx prisma validate && npx prisma format`
Expected: `The schema ... is valid 🚀`

- [ ] **Step 3: Commit**

```bash
git add apps/web/prisma/schema.prisma
git commit -m "feat(db): schéma prisma des 7 entités pivot"
```

---

## Task 5: Migration initiale + SQL custom (CHECK + index GIST)

**Files:**
- Create: `apps/web/prisma/migrations/*/migration.sql` (généré puis édité)

- [ ] **Step 1: Générer la migration sans l'appliquer**

Run: `cd apps/web && npx prisma migrate dev --name init_pivot --create-only`
Expected: crée `prisma/migrations/<timestamp>_init_pivot/migration.sql` (généré, non appliqué).

- [ ] **Step 2: Ajouter le SQL custom en fin de migration**

Éditer le fichier `prisma/migrations/<timestamp>_init_pivot/migration.sql` et **ajouter à la fin** :

```sql
-- Cohérence temporelle : une session se termine après son début.
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_end_after_start" CHECK ("end_at" > "start_at");

-- Index GIST sur l'expression tstzrange pour la détection de chevauchement (opérateur &&).
-- Réalise l'intention "period tstzrange" du spec sans colonne stockée.
CREATE INDEX "sessions_period_gist"
  ON "sessions"
  USING gist (tstzrange("start_at", "end_at"));
```

- [ ] **Step 3: Appliquer la migration**

Run: `cd apps/web && npx prisma migrate dev`
Expected: migration appliquée, `Already in sync` / `Database is now in sync with your schema`. Le client Prisma est régénéré.

- [ ] **Step 4: Vérifier que l'index existe**

Run: `docker exec tempora-postgres-dev psql -U tempora -d tempora -c "\di sessions_period_gist"`
Expected: une ligne listant l'index `sessions_period_gist` de type `gist`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/prisma/migrations
git commit -m "feat(db): migration initiale + CHECK et index GIST pour les conflits"
```

---

## Task 6: Fonction `computeBillableAmount` (TDD, pure)

**Files:**
- Create: `apps/web/lib/billing.ts`, `apps/web/tests/billing.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Create `apps/web/tests/billing.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeBillableAmount } from "../lib/billing";

describe("computeBillableAmount", () => {
  it("calcule durée × taux pour une session de 3h à 50€/h", () => {
    const start = new Date("2026-06-01T09:00:00Z");
    const end = new Date("2026-06-01T12:00:00Z");
    expect(computeBillableAmount(start, end, 50)).toBe(150);
  });

  it("gère les demi-heures (1h30 à 80€/h = 120€)", () => {
    const start = new Date("2026-06-01T09:00:00Z");
    const end = new Date("2026-06-01T10:30:00Z");
    expect(computeBillableAmount(start, end, 80)).toBe(120);
  });

  it("arrondit au centime", () => {
    const start = new Date("2026-06-01T09:00:00Z");
    const end = new Date("2026-06-01T09:20:00Z"); // 1/3 h
    expect(computeBillableAmount(start, end, 50)).toBe(16.67);
  });

  it("rejette une fin antérieure au début", () => {
    const start = new Date("2026-06-01T12:00:00Z");
    const end = new Date("2026-06-01T09:00:00Z");
    expect(() => computeBillableAmount(start, end, 50)).toThrow();
  });

  it("rejette un taux négatif", () => {
    const start = new Date("2026-06-01T09:00:00Z");
    const end = new Date("2026-06-01T10:00:00Z");
    expect(() => computeBillableAmount(start, end, -10)).toThrow();
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd apps/web && npx vitest run tests/billing.test.ts`
Expected: FAIL — `computeBillableAmount` introuvable.

- [ ] **Step 3: Implémenter la fonction**

Create `apps/web/lib/billing.ts`:

```typescript
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
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd apps/web && npx vitest run tests/billing.test.ts`
Expected: PASS (5 tests verts).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/billing.ts apps/web/tests/billing.test.ts
git commit -m "feat(billing): calcul du montant facturable + tests"
```

---

## Task 7: Fonction pure `overlaps` (TDD)

**Files:**
- Create: `apps/web/lib/conflicts.ts`, `apps/web/tests/overlaps.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

Create `apps/web/tests/overlaps.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { overlaps } from "../lib/conflicts";

const range = (s: string, e: string) =>
  ({ startAt: new Date(s), endAt: new Date(e) });

describe("overlaps", () => {
  it("détecte deux créneaux qui se chevauchent", () => {
    const a = range("2026-06-01T09:00:00Z", "2026-06-01T11:00:00Z");
    const b = range("2026-06-01T10:00:00Z", "2026-06-01T12:00:00Z");
    expect(overlaps(a, b)).toBe(true);
  });

  it("ne détecte pas de chevauchement pour des créneaux disjoints", () => {
    const a = range("2026-06-01T09:00:00Z", "2026-06-01T10:00:00Z");
    const b = range("2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z");
    expect(overlaps(a, b)).toBe(false); // contigus = pas de chevauchement (borne sup exclue)
  });

  it("est symétrique", () => {
    const a = range("2026-06-01T09:00:00Z", "2026-06-01T11:00:00Z");
    const b = range("2026-06-01T10:00:00Z", "2026-06-01T12:00:00Z");
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });

  it("détecte un créneau entièrement inclus dans un autre", () => {
    const a = range("2026-06-01T09:00:00Z", "2026-06-01T18:00:00Z");
    const b = range("2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z");
    expect(overlaps(a, b)).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd apps/web && npx vitest run tests/overlaps.test.ts`
Expected: FAIL — `overlaps` introuvable.

- [ ] **Step 3: Implémenter `overlaps` (et le type partagé)**

Create `apps/web/lib/conflicts.ts` (sans import de `prisma` pour l'instant — ajouté en Task 8 avec son usage, sinon ESLint signale un import inutilisé) :

```typescript
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
```

> `findOverlappingSessions` (requête DB) est introduite en Task 8, pour ne pas laisser de code non testé dans cette task.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd apps/web && npx vitest run tests/overlaps.test.ts`
Expected: PASS (4 tests verts).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/conflicts.ts apps/web/tests/overlaps.test.ts
git commit -m "feat(conflicts): fonction pure overlaps + tests"
```

---

## Task 8: Requête de détection de chevauchement (TDD, intégration Postgres)

**Files:**
- Modify: `apps/web/lib/conflicts.ts`
- Create: `apps/web/tests/conflicts.integration.test.ts`

- [ ] **Step 1: Ajouter `findOverlappingSessions` avec `Prisma.sql`**

Ajouter en haut de `apps/web/lib/conflicts.ts` les imports, puis la fonction à la fin du fichier :

```typescript
// En haut du fichier, avant `export interface TimeRange`
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
```

```typescript
// À la fin du fichier
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
    WHERE status IN ('proposal', 'confirmed')
      ${exclude}
      AND tstzrange(start_at, end_at) && tstzrange(${startAt}, ${endAt})
  `);
}
```

Le type `TimeRange` et la fonction `overlaps` de la Task 7 restent inchangés.

- [ ] **Step 2: Écrire le test d'intégration (échoue d'abord)**

Create `apps/web/tests/conflicts.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "../lib/db";
import { findOverlappingSessions } from "../lib/conflicts";

async function makeSchool() {
  return prisma.school.create({ data: { name: "École Test" } });
}

describe("findOverlappingSessions (intégration Postgres)", () => {
  beforeEach(async () => {
    // Nettoyage : ordre respectant les FK.
    await prisma.conflictSession.deleteMany();
    await prisma.session.deleteMany();
    await prisma.school.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("trouve une session existante qui chevauche le créneau demandé", async () => {
    const school = await makeSchool();
    await prisma.session.create({
      data: {
        schoolId: school.id,
        title: "Cours A",
        startAt: new Date("2026-06-01T09:00:00Z"),
        endAt: new Date("2026-06-01T11:00:00Z"),
        hourlyRate: "50.00",
        status: "confirmed",
      },
    });

    const hits = await findOverlappingSessions(
      new Date("2026-06-01T10:00:00Z"),
      new Date("2026-06-01T12:00:00Z"),
    );
    expect(hits).toHaveLength(1);
  });

  it("ignore les créneaux contigus (pas de chevauchement)", async () => {
    const school = await makeSchool();
    await prisma.session.create({
      data: {
        schoolId: school.id,
        title: "Cours A",
        startAt: new Date("2026-06-01T09:00:00Z"),
        endAt: new Date("2026-06-01T10:00:00Z"),
        hourlyRate: "50.00",
        status: "confirmed",
      },
    });

    const hits = await findOverlappingSessions(
      new Date("2026-06-01T10:00:00Z"),
      new Date("2026-06-01T11:00:00Z"),
    );
    expect(hits).toHaveLength(0);
  });

  it("ignore les sessions annulées", async () => {
    const school = await makeSchool();
    await prisma.session.create({
      data: {
        schoolId: school.id,
        title: "Cours annulé",
        startAt: new Date("2026-06-01T09:00:00Z"),
        endAt: new Date("2026-06-01T11:00:00Z"),
        hourlyRate: "50.00",
        status: "cancelled",
      },
    });

    const hits = await findOverlappingSessions(
      new Date("2026-06-01T10:00:00Z"),
      new Date("2026-06-01T12:00:00Z"),
    );
    expect(hits).toHaveLength(0);
  });

  it("exclut la session passée en excludeId", async () => {
    const school = await makeSchool();
    const s = await prisma.session.create({
      data: {
        schoolId: school.id,
        title: "Cours A",
        startAt: new Date("2026-06-01T09:00:00Z"),
        endAt: new Date("2026-06-01T11:00:00Z"),
        hourlyRate: "50.00",
        status: "confirmed",
      },
    });

    const hits = await findOverlappingSessions(
      new Date("2026-06-01T09:00:00Z"),
      new Date("2026-06-01T11:00:00Z"),
      s.id,
    );
    expect(hits).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Vérifier que la base de test est migrée, puis lancer le test**

Run:
```bash
cd apps/web && npx prisma migrate deploy && npx vitest run tests/conflicts.integration.test.ts
```
Expected: PASS (4 tests verts). Si la première exécution échoue parce que les tables n'existent pas, c'est que `migrate deploy` n'a pas tourné — relancer.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/conflicts.ts apps/web/tests/conflicts.integration.test.ts
git commit -m "feat(conflicts): requête tstzrange de détection + tests d'intégration"
```

---

## Task 9: Seed de démonstration

**Files:**
- Create: `apps/web/prisma/seed.ts`

- [ ] **Step 1: Écrire le seed**

Create `apps/web/prisma/seed.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Idempotent : on repart propre à chaque seed de dev.
  await prisma.conflictSession.deleteMany();
  await prisma.conflict.deleteMany();
  await prisma.invoiceLine.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.session.deleteMany();
  await prisma.ingestion.deleteMany();
  await prisma.school.deleteMany();

  const supdevinci = await prisma.school.create({
    data: {
      name: "Sup de Vinci",
      city: "Paris",
      country: "FR",
      defaultHourlyRate: "60.00",
      color: "#1d76db",
    },
  });

  const epitech = await prisma.school.create({
    data: {
      name: "Epitech",
      city: "Lyon",
      country: "FR",
      defaultHourlyRate: "55.00",
      color: "#e99695",
    },
  });

  await prisma.session.createMany({
    data: [
      {
        schoolId: supdevinci.id,
        title: "Architecture logicielle",
        classe: "B3 DEV",
        startAt: new Date("2026-06-01T09:00:00Z"),
        endAt: new Date("2026-06-01T12:00:00Z"),
        hourlyRate: "60.00",
        status: "confirmed",
        source: "manual",
      },
      {
        schoolId: epitech.id,
        title: "Bases de données",
        classe: "MSc1",
        // Chevauche volontairement la session précédente -> conflit de démo.
        startAt: new Date("2026-06-01T10:00:00Z"),
        endAt: new Date("2026-06-01T13:00:00Z"),
        hourlyRate: "55.00",
        status: "proposal",
        source: "ical",
      },
    ],
  });

  console.log("Seed terminé : 2 écoles, 2 sessions (dont 1 chevauchement).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Lancer le seed**

Run: `cd apps/web && npm run db:seed`
Expected: `Seed terminé : 2 écoles, 2 sessions (dont 1 chevauchement).`

- [ ] **Step 3: Vérifier en base**

Run: `docker exec tempora-postgres-dev psql -U tempora -d tempora -c "SELECT count(*) FROM schools; SELECT count(*) FROM sessions;"`
Expected: 2 écoles, 2 sessions.

- [ ] **Step 4: Commit**

```bash
git add apps/web/prisma/seed.ts
git commit -m "feat(db): seed de démonstration (écoles + sessions)"
```

---

## Task 10: Vérification finale de bout en bout

**Files:** aucun (vérification)

- [ ] **Step 1: Base propre, migration, seed, tests**

Run:
```bash
cd apps/web
npx prisma migrate reset --force   # recrée la base depuis les migrations + relance le seed
npm test                            # tous les tests : billing, overlaps, conflicts intégration
npx tsc --noEmit                    # zéro erreur de type (§9)
npm run lint                        # zéro warning ESLint (§9)
```
Expected : migrations appliquées, seed exécuté, **tous les tests verts**, `tsc` exit 0, lint propre.

- [ ] **Step 2: Commit final si des fichiers ont bougé (lockfile, etc.)**

```bash
git add -A
git commit -m "chore(db): vérification bout-en-bout du modèle de données" --allow-empty
```

---

## Résumé des livrables

- Postgres 16 de dev en Docker (`infra/docker-compose.dev.yml`).
- App Next.js scaffoldée, TypeScript strict.
- Schéma Prisma des 7 entités + 5 enums, migration versionnée avec CHECK + index GIST.
- Fonctions métier critiques testées : `computeBillableAmount`, `overlaps`, `findOverlappingSessions` (les 2 du §4.6 couvertes).
- Seed de démonstration avec un chevauchement volontaire.
- Pont vers la spec suivante (API-first) : routes + Zod s'appuieront sur ce client Prisma et ces fonctions.
```
