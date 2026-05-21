import { z } from "../api/zod";
import { registry } from "../api/openapi";
import { paginationMetaSchema, paginationQuerySchema } from "./common";

/**
 * Schémas Zod de la ressource `sessions` + enregistrement OpenAPI.
 *
 * Comme pour `schools`, ces schémas valident les requêtes ET génèrent le contrat
 * OpenAPI : une seule source de vérité (ADR-08).
 */

/** Statuts qu'un utilisateur peut poser via l'API. `invoiced` est réservé au
 *  workflow de facturation (positionné par le service factures, pas par CRUD). */
export const SESSION_STATUS_INPUT = [
  "proposal",
  "confirmed",
  "cancelled",
] as const;

/** Statuts complets, pour filtrer une liste (inclut `invoiced`, en lecture). */
const SESSION_STATUS_FILTER = [
  "proposal",
  "confirmed",
  "cancelled",
  "invoiced",
] as const;

const SOURCE_TYPES = [
  "outlook",
  "email",
  "csv",
  "ical",
  "scraper",
  "manual",
] as const;

/** Champs éditables d'une session, partagés création / mise à jour. */
const sessionWritableShape = {
  title: z.string().trim().min(1, "Le titre est requis.").max(200),
  classe: z.string().trim().max(100).nullish(),
  startAt: z.coerce.date({ message: "Date de début invalide." }),
  endAt: z.coerce.date({ message: "Date de fin invalide." }),
  // Optionnel : hérité du taux par défaut de l'école si absent (jamais null en base).
  hourlyRate: z
    .number()
    .nonnegative("Le taux horaire ne peut pas être négatif.")
    .optional(),
  status: z.enum(SESSION_STATUS_INPUT).optional(),
  location: z.string().trim().max(255).nullish(),
  source: z.enum(SOURCE_TYPES).optional(),
  notes: z.string().trim().max(2000).nullish(),
} as const;

export const sessionCreateSchema = z
  .object({
    schoolId: z.string().min(1, "L'école est requise."),
    ...sessionWritableShape,
  })
  .refine((data) => data.endAt > data.startAt, {
    message: "La date de fin doit être postérieure à la date de début.",
    path: ["endAt"],
  })
  .openapi("SessionCreate");

export type SessionCreateInput = z.infer<typeof sessionCreateSchema>;

/** Mise à jour partielle : au moins un champ. L'école n'est pas modifiable. */
export const sessionUpdateSchema = z
  .object(sessionWritableShape)
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Au moins un champ doit être fourni.",
  })
  .openapi("SessionUpdate");

export type SessionUpdateInput = z.infer<typeof sessionUpdateSchema>;

/** Filtres + pagination de la liste des sessions. */
export const sessionListQuerySchema = paginationQuerySchema.extend({
  schoolId: z.string().min(1).optional(),
  status: z.enum(SESSION_STATUS_FILTER).optional(),
  /** Borne basse (inclusive) sur la date de début. */
  from: z.coerce.date().optional(),
  /** Borne haute (exclusive) sur la date de début. */
  to: z.coerce.date().optional(),
});

export type SessionListQuery = z.infer<typeof sessionListQuerySchema>;

/** Forme JSON renvoyée par l'API (Decimal → string, dates → ISO). */
export const sessionResponseSchema = z
  .object({
    id: z.string(),
    schoolId: z.string(),
    title: z.string(),
    classe: z.string().nullable(),
    startAt: z.string(),
    endAt: z.string(),
    hourlyRate: z.string(),
    /** Dérivé : durée × taux, arrondi au centime. Lecture seule. */
    billableAmount: z.string(),
    status: z.enum(SESSION_STATUS_FILTER),
    location: z.string().nullable(),
    source: z.enum(SOURCE_TYPES),
    ingestionId: z.string().nullable(),
    invoiceId: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Session");

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// ---------------------------------------------------------------------------
// Enregistrement OpenAPI des routes
// ---------------------------------------------------------------------------

const sessionEnvelope = z.object({ data: sessionResponseSchema });
const sessionListEnvelope = z.object({
  data: z.array(sessionResponseSchema),
  pagination: paginationMetaSchema,
});
const conflictsEnvelope = z.object({ data: z.array(sessionResponseSchema) });

registry.registerPath({
  method: "get",
  path: "/sessions",
  tags: ["Sessions"],
  summary: "Lister les sessions",
  request: { query: sessionListQuerySchema },
  responses: {
    200: {
      description: "Liste paginée des sessions",
      content: { "application/json": { schema: sessionListEnvelope } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/sessions",
  tags: ["Sessions"],
  summary: "Créer une session",
  request: {
    body: { content: { "application/json": { schema: sessionCreateSchema } } },
  },
  responses: {
    201: {
      description: "Session créée",
      content: { "application/json": { schema: sessionEnvelope } },
    },
    404: { description: "École introuvable" },
    422: { description: "Entrée invalide (ex. taux manquant, dates incohérentes)" },
  },
});

registry.registerPath({
  method: "get",
  path: "/sessions/{id}",
  tags: ["Sessions"],
  summary: "Récupérer une session",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Session",
      content: { "application/json": { schema: sessionEnvelope } },
    },
    404: { description: "Session introuvable" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/sessions/{id}",
  tags: ["Sessions"],
  summary: "Mettre à jour une session",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: sessionUpdateSchema } } },
  },
  responses: {
    200: {
      description: "Session mise à jour",
      content: { "application/json": { schema: sessionEnvelope } },
    },
    404: { description: "Session introuvable" },
    422: { description: "Entrée invalide" },
  },
});

registry.registerPath({
  method: "delete",
  path: "/sessions/{id}",
  tags: ["Sessions"],
  summary: "Annuler une session (passe le statut à cancelled)",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "Session annulée" },
    404: { description: "Session introuvable" },
  },
});

registry.registerPath({
  method: "get",
  path: "/sessions/{id}/conflicts",
  tags: ["Sessions"],
  summary: "Lister les sessions en conflit horaire avec celle-ci",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Sessions actives chevauchant le créneau",
      content: { "application/json": { schema: conflictsEnvelope } },
    },
    404: { description: "Session introuvable" },
  },
});
