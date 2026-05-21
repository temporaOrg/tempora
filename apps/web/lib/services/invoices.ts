import { prisma } from "../db";
import { Prisma, type InvoiceStatus } from "../generated/prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "../api/errors";
import { recordAudit } from "../audit";
import { computeDurationHours } from "../billing";
import { buildPaginationMeta } from "../validators/common";
import type { PaginationMeta } from "../api/response";
import type {
  InvoiceGenerateInput,
  InvoiceListQuery,
  InvoiceResponse,
  InvoiceUpdateInput,
} from "../validators/invoices";

/**
 * Logique métier de la ressource `invoices`.
 *
 * Une facture agrège les sessions `confirmed` d'une école sur une période en
 * lignes figées (une ligne par session), puis suit son cycle de vie. Le push
 * vers Pennylane est orchestré par n8n, qui réécrit `number`/`pennylaneId` via
 * `updateInvoice` (ADR-03) ; ce service ne parle jamais à Pennylane.
 *
 * TVA : franchise en base par défaut (formateur indépendant, art. 293 B du CGI)
 * → `taxAmount` à 0 et `total` = `subtotal`. Le jour où l'assujettissement
 * change, c'est le seul endroit à faire évoluer.
 */

const ENTITY_TYPE = "invoice";

/**
 * Date d'une session dans le fuseau du formateur (CLAUDE.md §4.9), pour
 * l'intitulé de ligne de facture. `toISOString` donnerait la date UTC : une
 * session en soirée bascule alors d'un jour, ce qui daterait faux une ligne
 * facturée. `en-CA` formate en `YYYY-MM-DD`. (`date-fns-tz` n'est pas encore
 * dans la stack ; `Intl` couvre ce besoin ponctuel sans dépendance.)
 */
const PARIS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Transitions de cycle de vie autorisées. L'annulation passe par `cancelInvoice`. */
const ALLOWED_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["issued"],
  issued: ["sent", "paid"],
  sent: ["paid"],
  paid: [],
  cancelled: [],
};

/** Facture chargée avec ses lignes et les ID des sessions rattachées. */
type InvoiceWithRelations = Prisma.InvoiceGetPayload<{
  include: { lines: true; sessions: { select: { id: true } } };
}>;

const withRelations = {
  lines: { orderBy: { createdAt: "asc" } },
  sessions: { select: { id: true } },
} as const satisfies Prisma.InvoiceInclude;

/** Mappe une facture Prisma (+ relations) vers la forme JSON exposée. */
function toResponse(invoice: InvoiceWithRelations): InvoiceResponse {
  return {
    id: invoice.id,
    schoolId: invoice.schoolId,
    number: invoice.number,
    status: invoice.status,
    periodStart: invoice.periodStart.toISOString(),
    periodEnd: invoice.periodEnd.toISOString(),
    currency: invoice.currency,
    subtotal: invoice.subtotal.toFixed(2),
    taxAmount: invoice.taxAmount.toFixed(2),
    total: invoice.total.toFixed(2),
    pennylaneId: invoice.pennylaneId,
    issuedAt: invoice.issuedAt ? invoice.issuedAt.toISOString() : null,
    dueAt: invoice.dueAt ? invoice.dueAt.toISOString() : null,
    paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      sessionId: line.sessionId,
      label: line.label,
      quantity: line.quantity.toFixed(2),
      unitPrice: line.unitPrice.toFixed(2),
      amount: line.amount.toFixed(2),
      createdAt: line.createdAt.toISOString(),
    })),
    sessionIds: invoice.sessions.map((s) => s.id),
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

/**
 * Génère une facture brouillon : agrège les sessions `confirmed` de l'école sur
 * [periodStart, periodEnd), les fige en `invoiced` et crée une ligne par session.
 *
 * Concurrence : tout dans une transaction précédée d'un verrou consultatif par
 * école. Deux générations simultanées sur la même école sont sérialisées — sans
 * quoi elles pourraient sélectionner les mêmes sessions `confirmed` et les
 * facturer en double (la sélection ne se ferme qu'à la mise à jour des statuts).
 */
export async function generateInvoice(
  input: InvoiceGenerateInput,
  actor: string,
): Promise<InvoiceResponse> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tempora_invoice_gen:${input.schoolId}`}))`;

    const school = await tx.school.findUnique({ where: { id: input.schoolId } });
    if (!school) {
      throw new NotFoundError("École introuvable.");
    }

    const sessions = await tx.session.findMany({
      where: {
        schoolId: input.schoolId,
        status: "confirmed",
        startAt: { gte: input.periodStart, lt: input.periodEnd },
      },
      orderBy: { startAt: "asc" },
    });
    if (sessions.length === 0) {
      throw new ValidationError(
        "Aucune session confirmée à facturer sur cette période.",
      );
    }

    // Une ligne par session. Le montant est recalculé à partir de la quantité
    // arrondie (quantité × prix unitaire = montant, pour réconcilier le total).
    const lines = sessions.map((session) => {
      const quantity = computeDurationHours(session.startAt, session.endAt);
      const amount = quantity.mul(session.hourlyRate).toDecimalPlaces(2);
      const day = PARIS_DAY.format(session.startAt);
      return {
        sessionId: session.id,
        label: `${session.title} (${day})`,
        quantity,
        unitPrice: session.hourlyRate,
        amount,
      };
    });

    const subtotal = lines.reduce(
      (sum, line) => sum.add(line.amount),
      new Prisma.Decimal(0),
    );
    const taxAmount = new Prisma.Decimal(0); // franchise en base (cf. en-tête)
    // Arrondi au centime sur le total porté au grand livre : invariant qui tient
    // déjà à TVA nulle, mais qui doit rester garanti le jour d'un taux non nul.
    const total = subtotal.add(taxAmount).toDecimalPlaces(2);

    const invoice = await tx.invoice.create({
      data: {
        schoolId: input.schoolId,
        status: "draft",
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        currency: "EUR",
        subtotal,
        taxAmount,
        total,
        lines: {
          create: lines.map((line) => ({
            sessionId: line.sessionId,
            label: line.label,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            amount: line.amount,
          })),
        },
      },
    });

    // Fige les sessions : elles ne sont plus modifiables (assertNotInvoiced).
    await tx.session.updateMany({
      where: { id: { in: sessions.map((s) => s.id) } },
      data: { status: "invoiced", invoiceId: invoice.id },
    });

    const full = await tx.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: withRelations,
    });
    const dto = toResponse(full);
    await recordAudit(
      { actor, action: "create", entityType: ENTITY_TYPE, entityId: invoice.id, after: dto },
      tx,
    );
    return dto;
  });
}

export async function listInvoices(query: InvoiceListQuery): Promise<{
  data: InvoiceResponse[];
  pagination: PaginationMeta;
}> {
  const where: Prisma.InvoiceWhereInput = {
    ...(query.schoolId ? { schoolId: query.schoolId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: withRelations,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    data: rows.map(toResponse),
    pagination: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function getInvoice(id: string): Promise<InvoiceResponse> {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: withRelations,
  });
  if (!invoice) {
    throw new NotFoundError("Facture introuvable.");
  }
  return toResponse(invoice);
}

/**
 * Fait avancer le cycle de vie et/ou réécrit les références Pennylane.
 * Le passage à `issued` est l'émission de la facture : action critique tracée
 * `issue_invoice` (CLAUDE.md §4.2), avec horodatage `issuedAt`. Le passage à
 * `paid` horodate `paidAt` (sauf valeur explicite fournie).
 */
export async function updateInvoice(
  id: string,
  input: InvoiceUpdateInput,
  actor: string,
): Promise<InvoiceResponse> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({
      where: { id },
      include: withRelations,
    });
    if (!existing) {
      throw new NotFoundError("Facture introuvable.");
    }

    if (input.status && !ALLOWED_TRANSITIONS[existing.status].includes(input.status)) {
      throw new ConflictError(
        `Transition de statut interdite : ${existing.status} → ${input.status}.`,
      );
    }

    const updated = await tx.invoice.update({
      where: { id },
      data: {
        status: input.status,
        number: input.number,
        pennylaneId: input.pennylaneId,
        dueAt: input.dueAt,
        // Émission et paiement s'horodatent à la première transition concernée.
        issuedAt:
          input.status === "issued" && !existing.issuedAt
            ? new Date()
            : undefined,
        // `paidAt` ne s'écrit qu'au passage à `paid` (comme `issuedAt` à
        // `issued`) : un PATCH de métadonnées Pennylane ne doit pas horodater un
        // paiement sur une facture qui n'est pas marquée payée.
        paidAt:
          input.status === "paid" ? (input.paidAt ?? new Date()) : undefined,
      },
      include: withRelations,
    });

    const dto = toResponse(updated);
    await recordAudit(
      {
        actor,
        action: input.status === "issued" ? "issue_invoice" : "update",
        entityType: ENTITY_TYPE,
        entityId: id,
        before: toResponse(existing),
        after: dto,
      },
      tx,
    );
    return dto;
  });
}

/**
 * Annule une facture et libère ses sessions (retour en `confirmed`, refacturable).
 * Réservé aux brouillons : une fois émise, la facture existe côté Pennylane et
 * son annulation relève d'un avoir (hors périmètre). Idempotent.
 */
export async function cancelInvoice(id: string, actor: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({
      where: { id },
      include: withRelations,
    });
    if (!existing) {
      throw new NotFoundError("Facture introuvable.");
    }
    if (existing.status === "cancelled") return; // idempotent
    if (existing.status !== "draft") {
      throw new ConflictError(
        "Seule une facture brouillon peut être annulée ; une facture émise nécessite un avoir.",
      );
    }

    await tx.invoice.update({
      where: { id },
      data: { status: "cancelled" },
    });
    // Libère les sessions figées : elles redeviennent facturables.
    await tx.session.updateMany({
      where: { invoiceId: id },
      data: { status: "confirmed", invoiceId: null },
    });

    await recordAudit(
      {
        actor,
        action: "delete",
        entityType: ENTITY_TYPE,
        entityId: id,
        before: toResponse(existing),
        after: { status: "cancelled" as InvoiceStatus },
      },
      tx,
    );
  });
}
