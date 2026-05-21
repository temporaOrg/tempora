import { z } from "../api/zod";
import { registry } from "../api/openapi";
import { paginationMetaSchema, paginationQuerySchema } from "./common";

/**
 * Schémas Zod de la ressource `invoices` + enregistrement OpenAPI.
 *
 * Une facture est le pivot de facturation : elle agrège les sessions
 * `confirmed` d'une école sur une période en lignes figées, puis suit un cycle
 * de vie (brouillon → émise → envoyée → payée). Le push effectif vers Pennylane
 * (Plateforme Agréée) est orchestré par n8n, qui réécrit `number` et
 * `pennylaneId` via le PATCH une fois la facture créée côté Pennylane (ADR-03).
 *
 * Comme partout, ces schémas valident les requêtes ET génèrent le contrat
 * OpenAPI : une seule source de vérité (ADR-08).
 */

/** Cycle de vie complet d'une facture (pour filtrer une liste). */
const INVOICE_STATUS = ["draft", "issued", "sent", "paid", "cancelled"] as const;

/**
 * Statuts qu'un PATCH peut poser. `draft` est exclu (on ne revient pas en
 * arrière) et `cancelled` aussi : l'annulation passe par DELETE, qui libère en
 * plus les sessions rattachées. Le PATCH ne fait qu'avancer dans le cycle.
 */
const INVOICE_STATUS_TRANSITION = ["issued", "sent", "paid"] as const;

/**
 * Génération d'une facture : on agrège les sessions `confirmed` d'une école sur
 * une période. Bornes en convention [début, fin) — `periodStart` inclusive,
 * `periodEnd` exclusive — alignée sur le filtre `to` de la liste des sessions.
 */
export const invoiceGenerateSchema = z
  .object({
    schoolId: z.string().min(1, "L'école est requise."),
    periodStart: z.coerce.date({ message: "Date de début de période invalide." }),
    periodEnd: z.coerce.date({ message: "Date de fin de période invalide." }),
  })
  .refine((data) => data.periodEnd > data.periodStart, {
    message: "La fin de période doit être postérieure au début.",
    path: ["periodEnd"],
  })
  .openapi("InvoiceGenerate");

export type InvoiceGenerateInput = z.infer<typeof invoiceGenerateSchema>;

/**
 * Mise à jour d'une facture : avancée du cycle de vie et/ou réécriture des
 * références Pennylane par n8n (numéro, identifiant distant, échéance, paiement).
 * Au moins un champ requis.
 */
export const invoiceUpdateSchema = z
  .object({
    status: z.enum(INVOICE_STATUS_TRANSITION),
    number: z.string().trim().min(1).max(100),
    pennylaneId: z.string().trim().min(1).max(255),
    dueAt: z.coerce.date(),
    paidAt: z.coerce.date(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Au moins un champ doit être fourni.",
  })
  .openapi("InvoiceUpdate");

export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;

/** Filtres + pagination de la liste des factures. */
export const invoiceListQuerySchema = paginationQuerySchema.extend({
  schoolId: z.string().min(1).optional(),
  status: z.enum(INVOICE_STATUS).optional(),
});

export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

/** Ligne de facture (montants Decimal → string). */
export const invoiceLineResponseSchema = z
  .object({
    id: z.string(),
    /** Session facturée par cette ligne (null si ligne libre). */
    sessionId: z.string().nullable(),
    label: z.string(),
    quantity: z.string(),
    unitPrice: z.string(),
    amount: z.string(),
    createdAt: z.string(),
  })
  .openapi("InvoiceLine");

/** Forme JSON renvoyée par l'API (Decimal → string, dates → ISO). */
export const invoiceResponseSchema = z
  .object({
    id: z.string(),
    schoolId: z.string(),
    number: z.string().nullable(),
    status: z.enum(INVOICE_STATUS),
    periodStart: z.string(),
    periodEnd: z.string(),
    currency: z.string(),
    subtotal: z.string(),
    taxAmount: z.string(),
    total: z.string(),
    pennylaneId: z.string().nullable(),
    issuedAt: z.string().nullable(),
    dueAt: z.string().nullable(),
    paidAt: z.string().nullable(),
    lines: z.array(invoiceLineResponseSchema),
    /** ID des sessions rattachées (figées en `invoiced` tant que la facture vit). */
    sessionIds: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Invoice");

export type InvoiceResponse = z.infer<typeof invoiceResponseSchema>;

// ---------------------------------------------------------------------------
// Enregistrement OpenAPI des routes
// ---------------------------------------------------------------------------

const invoiceEnvelope = z.object({ data: invoiceResponseSchema });
const invoiceListEnvelope = z.object({
  data: z.array(invoiceResponseSchema),
  pagination: paginationMetaSchema,
});

registry.registerPath({
  method: "get",
  path: "/invoices",
  tags: ["Invoices"],
  summary: "Lister les factures",
  request: { query: invoiceListQuerySchema },
  responses: {
    200: {
      description: "Liste paginée des factures",
      content: { "application/json": { schema: invoiceListEnvelope } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/invoices",
  tags: ["Invoices"],
  summary: "Générer une facture brouillon depuis les sessions confirmées d'une période",
  request: {
    body: { content: { "application/json": { schema: invoiceGenerateSchema } } },
  },
  responses: {
    201: {
      description: "Facture brouillon créée",
      content: { "application/json": { schema: invoiceEnvelope } },
    },
    404: { description: "École introuvable" },
    422: { description: "Aucune session confirmée à facturer sur la période" },
  },
});

registry.registerPath({
  method: "get",
  path: "/invoices/{id}",
  tags: ["Invoices"],
  summary: "Récupérer une facture",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Facture",
      content: { "application/json": { schema: invoiceEnvelope } },
    },
    404: { description: "Facture introuvable" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/invoices/{id}",
  tags: ["Invoices"],
  summary: "Faire avancer le cycle de vie / réécrire les références Pennylane",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: invoiceUpdateSchema } } },
  },
  responses: {
    200: {
      description: "Facture mise à jour",
      content: { "application/json": { schema: invoiceEnvelope } },
    },
    404: { description: "Facture introuvable" },
    409: { description: "Transition de statut interdite" },
    422: { description: "Entrée invalide" },
  },
});

registry.registerPath({
  method: "delete",
  path: "/invoices/{id}",
  tags: ["Invoices"],
  summary: "Annuler une facture brouillon (libère les sessions rattachées)",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "Facture annulée" },
    404: { description: "Facture introuvable" },
    409: { description: "Seule une facture brouillon peut être annulée" },
  },
});
