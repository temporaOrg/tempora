import { z } from "../api/zod";
import { registry } from "../api/openapi";
import { paginationMetaSchema, paginationQuerySchema } from "./common";

/**
 * Schémas Zod de la ressource `schools` + enregistrement OpenAPI.
 *
 * Les mêmes schémas valident les requêtes (handlers) ET génèrent le contrat
 * OpenAPI. Toute évolution du contrat passe donc par ces schémas, jamais par
 * un document écrit à part.
 */

const COUNTRY_DEFAULT = "FR";

/** Champs éditables d'une école, partagés création / mise à jour. */
const schoolWritableShape = {
  name: z.string().trim().min(1, "Le nom est requis.").max(200),
  siret: z
    .string()
    .trim()
    .regex(/^\d{14}$/, "Le SIRET doit comporter 14 chiffres.")
    .nullish(),
  vatNumber: z.string().trim().max(20).nullish(),
  addressLine: z.string().trim().max(255).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  city: z.string().trim().max(100).nullish(),
  country: z.string().trim().length(2, "Code pays ISO à 2 lettres.").optional(),
  billingEmail: z.email("Email de facturation invalide.").nullish(),
  defaultHourlyRate: z
    .number()
    .nonnegative("Le taux horaire ne peut pas être négatif.")
    .nullish(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Couleur attendue au format hexadécimal #RRGGBB.")
    .nullish(),
} as const;

export const schoolCreateSchema = z
  .object(schoolWritableShape)
  .openapi("SchoolCreate");

export type SchoolCreateInput = z.infer<typeof schoolCreateSchema>;

/** Mise à jour partielle : au moins un champ requis. */
export const schoolUpdateSchema = z
  .object(schoolWritableShape)
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Au moins un champ doit être fourni.",
  })
  .openapi("SchoolUpdate");

export type SchoolUpdateInput = z.infer<typeof schoolUpdateSchema>;

/** Filtres + pagination de la liste des écoles. */
export const schoolListQuerySchema = paginationQuerySchema.extend({
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  search: z.string().trim().min(1).optional(),
});

export type SchoolListQuery = z.infer<typeof schoolListQuerySchema>;

/** Forme JSON renvoyée par l'API (Decimal → string, dates → ISO). */
export const schoolResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    siret: z.string().nullable(),
    vatNumber: z.string().nullable(),
    addressLine: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string(),
    billingEmail: z.string().nullable(),
    defaultHourlyRate: z.string().nullable(),
    color: z.string().nullable(),
    isArchived: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("School");

export type SchoolResponse = z.infer<typeof schoolResponseSchema>;

// ---------------------------------------------------------------------------
// Enregistrement OpenAPI des routes
// ---------------------------------------------------------------------------

const schoolEnvelope = z.object({ data: schoolResponseSchema });
const schoolListEnvelope = z.object({
  data: z.array(schoolResponseSchema),
  pagination: paginationMetaSchema,
});

registry.registerPath({
  method: "get",
  path: "/schools",
  tags: ["Schools"],
  summary: "Lister les écoles",
  request: { query: schoolListQuerySchema },
  responses: {
    200: {
      description: "Liste paginée des écoles",
      content: { "application/json": { schema: schoolListEnvelope } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/schools",
  tags: ["Schools"],
  summary: "Créer une école",
  request: {
    body: { content: { "application/json": { schema: schoolCreateSchema } } },
  },
  responses: {
    201: {
      description: "École créée",
      content: { "application/json": { schema: schoolEnvelope } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/schools/{id}",
  tags: ["Schools"],
  summary: "Récupérer une école",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "École",
      content: { "application/json": { schema: schoolEnvelope } },
    },
    404: { description: "École introuvable" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/schools/{id}",
  tags: ["Schools"],
  summary: "Mettre à jour une école",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: schoolUpdateSchema } } },
  },
  responses: {
    200: {
      description: "École mise à jour",
      content: { "application/json": { schema: schoolEnvelope } },
    },
    404: { description: "École introuvable" },
  },
});

registry.registerPath({
  method: "delete",
  path: "/schools/{id}",
  tags: ["Schools"],
  summary: "Archiver une école (soft-delete)",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "École archivée" },
    404: { description: "École introuvable" },
  },
});

export { COUNTRY_DEFAULT };
