# Spec — Modèle de données pivot Tempora

> Date : 2026-05-21 · Périmètre : `apps/web` (Prisma + Postgres) · Approche : API-first.
> Référence de conventions : `CLAUDE.md` (§4.1, §4.2, §4.9, ADR-02).

## 1. Objectif

Définir le schéma de la base pivot PostgreSQL qui sert de source unique de vérité à Tempora. Ce schéma sous-tend toute l'API métier et, ensuite, le front. Il doit être normalisé, performant (index ciblés + GIST sur les ranges), et conforme aux exigences de facturation (réforme 2027) et d'audit.

## 2. Principes de modélisation retenus

1. **Cycle de vie par statut, pas par table.** Une `session` garde le même `id` de la candidate jusqu'à la facturation. On applique le §4.1 (unions discriminées) plutôt que des tables de staging dupliquées. L'audit d'une entité est ainsi continu.
2. **Le brut ingéré est isolé du modèle métier.** La donnée crasseuse des sources externes atterrit dans `ingestions` (payload `jsonb`), est normalisée par n8n + LLM, puis crée une `session` au statut `proposal`. `sessions` ne contient que du normalisé.
3. **Conformité facturation par snapshot immuable.** Une facture émise est un document légal : ses lignes (`invoice_lines`) figent libellé/quantité/prix au moment de l'émission, indépendamment des mutations ultérieures de la session.
4. **Souveraineté et auditabilité.** Soft-delete par `is_archived` (pas de suppression sèche), `audit_logs` sur toute mutation critique, brut conservé.

## 3. Diagramme logique

```
ingestions ──(normalise)──▶ sessions ◀──── conflict_sessions ──▶ conflicts
                              │  │
                    school_id │  │ invoice_id
                              ▼  ▼
                          schools ◀── invoices ──▶ invoice_lines (snapshot immuable)

audit_logs : transverse, journalise toute mutation critique
```

## 4. Entités

### 4.1 `schools`
Écoles partenaires, à la fois lieu d'intervention et entité de facturation.

| Colonne | Type | Contraintes / note |
|---|---|---|
| `id` | cuid | PK |
| `name` | text | NOT NULL |
| `siret` | text? | rempli via Pappers/INSEE |
| `vat_number` | text? | TVA intracom |
| `address_line` | text? | |
| `postal_code` | text? | |
| `city` | text? | |
| `country` | text? | défaut `FR` |
| `billing_email` | text? | |
| `default_hourly_rate` | Decimal(10,2)? | pré-remplit le taux des nouvelles sessions |
| `color` | text? | couleur calendrier (FullCalendar) |
| `is_archived` | boolean | défaut `false`, soft-delete |
| `created_at` | timestamptz | défaut `now()` |
| `updated_at` | timestamptz | `@updatedAt` |

Relations : `sessions[]`, `invoices[]`.

### 4.2 `sessions`
Cœur du modèle. Machine à états sur `status`.

| Colonne | Type | Contraintes / note |
|---|---|---|
| `id` | cuid | PK, stable sur tout le cycle de vie |
| `school_id` | cuid | FK → schools, NOT NULL |
| `title` | text | NOT NULL — intitulé du cours |
| `classe` | text? | ex. « B3 DEV » (champ texte, pas d'entité) |
| `start_at` | timestamptz | NOT NULL |
| `end_at` | timestamptz | NOT NULL, CHECK `end_at > start_at` |
| `period` | tstzrange | **colonne générée** `tstzrange(start_at, end_at)`, index GIST |
| `hourly_rate` | Decimal(10,2) | NOT NULL, snapshot (défaut hérité de l'école) |
| `status` | enum `session_status` | `proposal · confirmed · cancelled · invoiced` |
| `location` | text? | salle / visio |
| `source` | enum `source_type` | `outlook · email · csv · ical · scraper · manual` |
| `ingestion_id` | cuid? | FK → ingestions (provenance) |
| `invoice_id` | cuid? | FK → invoices |
| `notes` | text? | |
| `created_at` | timestamptz | défaut `now()` |
| `updated_at` | timestamptz | `@updatedAt` |

Index : `school_id`, `status`, `start_at`, GIST sur `period`.

Le montant facturable (`durée_heures × hourly_rate`) est **calculé**, jamais stocké sur la session ; il est figé dans `invoice_lines` à l'émission.

### 4.3 `ingestions`
Zone tampon du brut ingéré.

| Colonne | Type | Note |
|---|---|---|
| `id` | cuid | PK |
| `source` | enum `source_type` | |
| `external_id` | text? | clé de dédup côté source |
| `raw_payload` | jsonb | donnée brute conservée |
| `status` | enum `ingestion_status` | `pending · normalized · failed · ignored` |
| `error` | text? | message si échec |
| `received_at` | timestamptz | défaut `now()` |
| `processed_at` | timestamptz? | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Relations : `session?` (la session produite). Index : `status`, `external_id`.

### 4.4 `conflicts` + `conflict_sessions`
Un conflit regroupe N sessions qui se chevauchent (gère les clusters, pas seulement les paires).

**`conflicts`** : `id` (cuid), `status` (enum `conflict_status` : `open · resolved · ignored`), `detected_at` (timestamptz), `resolved_at` (timestamptz?), `resolution_note` (text?), `created_at`, `updated_at`.

**`conflict_sessions`** (liaison) : `conflict_id` (FK), `session_id` (FK), PK composite `(conflict_id, session_id)`.

Détection : `period && period` sur les sessions de statut `proposal` + `confirmed`. **Unique exception au « pas de SQL brut » (§4.2), justifiée par l'ADR-02**, exécutée en `$queryRaw` typé.

### 4.5 `invoices` + `invoice_lines`

**`invoices`** :

| Colonne | Type | Note |
|---|---|---|
| `id` | cuid | PK |
| `school_id` | cuid | FK, NOT NULL |
| `number` | text? | n° légal, null tant que `draft` |
| `status` | enum `invoice_status` | `draft · issued · sent · paid · cancelled` |
| `period_start` | date | |
| `period_end` | date | |
| `currency` | text | défaut `EUR` |
| `subtotal` | Decimal(10,2) | |
| `tax_amount` | Decimal(10,2) | |
| `total` | Decimal(10,2) | |
| `pennylane_id` | text? | réf. Plateforme Agréée |
| `issued_at` | timestamptz? | |
| `due_at` | timestamptz? | |
| `paid_at` | timestamptz? | |
| `created_at`, `updated_at` | timestamptz | |

**`invoice_lines`** (snapshot immuable) : `id` (cuid), `invoice_id` (FK), `session_id` (cuid?, lien faible vers la session d'origine), `label` (text), `quantity` (Decimal — heures), `unit_price` (Decimal(10,2)), `amount` (Decimal(10,2)), `created_at`.

### 4.6 `audit_logs`
Journal des mutations critiques (§4.2).

`id` (cuid), `actor` (text — email admin), `action` (text : `create`, `update`, `delete`, `resolve_conflict`, `issue_invoice`…), `entity_type` (text), `entity_id` (text), `before` (jsonb?), `after` (jsonb?), `created_at` (timestamptz). Index `(entity_type, entity_id)`.

> `action` est un `text` (pas un enum Postgres) : les actions auditables s'ajouteront au fil des features, et un enum imposerait une migration à chaque ajout. La validation des valeurs se fait côté applicatif via Zod.

### 4.7 Pas de table `users`
Conforme §4.3 : mono-utilisateur, admin seedé depuis `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`). `audit_logs.actor` = cet email. Migration future vers `users` sans réécriture.

## 5. Énumérations

- `session_status` : `proposal`, `confirmed`, `cancelled`, `invoiced`
- `source_type` : `outlook`, `email`, `csv`, `ical`, `scraper`, `manual`
- `ingestion_status` : `pending`, `normalized`, `failed`, `ignored`
- `conflict_status` : `open`, `resolved`, `ignored`
- `invoice_status` : `draft`, `issued`, `sent`, `paid`, `cancelled`

## 6. Choix techniques (conventions)

- Dates en `timestamptz` (UTC), affichage front via `date-fns-tz` / `Europe/Paris` (§4.9).
- Argent en `Decimal(10,2)`, jamais `Float`.
- `period tstzrange` : colonne générée + index GIST via migration SQL custom (Prisma ne gère pas les range types nativement). Seul endroit hors Prisma pur, documenté ici.
- IDs en `cuid` (URL-safe, non énumérable).
- Enums Postgres natifs mappés en enums Prisma.
- Tables `snake_case` pluriel, colonnes `snake_case` (mapping via `@@map` / `@map`), modèles Prisma `PascalCase` singulier.

## 7. Hypothèses métier (validées avec le porteur)

1. Pas d'entité `mission`/`classe` : `classe` = champ texte ; le taux vit sur la session (défaut hérité de l'école) ; le regroupement de facturation est porté par l'`invoice`.
2. Taux en snapshot sur la session : modifier le tarif d'une école n'altère pas les sessions existantes.
3. Soft-delete par `is_archived` plutôt que suppression sèche (exigence d'audit).

## 8. Hors périmètre de cette spec

- Le détail des routes API et des schémas Zod (spec suivante, API-first).
- Les workflows n8n d'ingestion (équipe infra/n8n).
- Le seed admin et la config Auth.js (séance S2).
