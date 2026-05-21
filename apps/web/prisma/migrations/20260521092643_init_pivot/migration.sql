-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('proposal', 'confirmed', 'cancelled', 'invoiced');

-- CreateEnum
CREATE TYPE "source_type" AS ENUM ('outlook', 'email', 'csv', 'ical', 'scraper', 'manual');

-- CreateEnum
CREATE TYPE "ingestion_status" AS ENUM ('pending', 'normalized', 'failed', 'ignored');

-- CreateEnum
CREATE TYPE "conflict_status" AS ENUM ('open', 'resolved', 'ignored');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('draft', 'issued', 'sent', 'paid', 'cancelled');

-- CreateTable
CREATE TABLE "schools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siret" TEXT,
    "vat_number" TEXT,
    "address_line" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'FR',
    "billing_email" TEXT,
    "default_hourly_rate" DECIMAL(10,2),
    "color" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "classe" TEXT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "hourly_rate" DECIMAL(10,2) NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'proposal',
    "location" TEXT,
    "source" "source_type" NOT NULL DEFAULT 'manual',
    "ingestion_id" TEXT,
    "invoice_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestions" (
    "id" TEXT NOT NULL,
    "source" "source_type" NOT NULL,
    "external_id" TEXT,
    "raw_payload" JSONB NOT NULL,
    "status" "ingestion_status" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ingestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflicts" (
    "id" TEXT NOT NULL,
    "status" "conflict_status" NOT NULL DEFAULT 'open',
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_sessions" (
    "conflict_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,

    CONSTRAINT "conflict_sessions_pkey" PRIMARY KEY ("conflict_id","session_id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "number" TEXT,
    "status" "invoice_status" NOT NULL DEFAULT 'draft',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pennylane_id" TEXT,
    "issued_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "session_id" TEXT,
    "label" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_school_id_idx" ON "sessions"("school_id");

-- CreateIndex
CREATE INDEX "sessions_status_idx" ON "sessions"("status");

-- CreateIndex
CREATE INDEX "sessions_start_at_idx" ON "sessions"("start_at");

-- CreateIndex
CREATE INDEX "ingestions_status_idx" ON "ingestions"("status");

-- CreateIndex
CREATE INDEX "ingestions_external_id_idx" ON "ingestions"("external_id");

-- CreateIndex
CREATE INDEX "conflicts_status_idx" ON "conflicts"("status");

-- CreateIndex
CREATE INDEX "invoices_school_id_idx" ON "invoices"("school_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_ingestion_id_fkey" FOREIGN KEY ("ingestion_id") REFERENCES "ingestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_sessions" ADD CONSTRAINT "conflict_sessions_conflict_id_fkey" FOREIGN KEY ("conflict_id") REFERENCES "conflicts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_sessions" ADD CONSTRAINT "conflict_sessions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- SQL custom (hors capacités du schéma Prisma) — cf. ADR-02
-- ============================================================

-- Cohérence temporelle : une session se termine après son début.
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_end_after_start" CHECK ("end_at" > "start_at");

-- Index GIST sur l'expression tstzrange pour la détection de chevauchement (opérateur &&).
-- Réalise l'intention "period tstzrange" du spec sans colonne stockée.
CREATE INDEX "sessions_period_gist"
  ON "sessions"
  USING gist (tstzrange("start_at", "end_at"));
