import { z } from "../api/zod";
import { registry } from "../api/openapi";
import { paginationMetaSchema, paginationQuerySchema } from "./common";
import { sessionResponseSchema } from "./sessions";

/**
 * Schémas Zod de la ressource `conflicts` + enregistrement OpenAPI.
 *
 * Un conflit matérialise un chevauchement horaire entre deux sessions actives
 * (table `conflicts` / `conflict_sessions`). La détection le crée, le formateur
 * le résout. Comme partout, ces schémas valident les requêtes ET génèrent le
 * contrat OpenAPI (ADR-08).
 */

/** Statuts complets d'un conflit (pour filtrer une liste). */
const CONFLICT_STATUS = ["open", "resolved", "ignored"] as const;

/**
 * Statuts qu'une action de résolution peut poser. `open` est exclu : seul le
 * moteur de détection ouvre un conflit, jamais l'utilisateur.
 */
const CONFLICT_RESOLUTION_STATUS = ["resolved", "ignored"] as const;

/** Corps du PATCH de résolution : nouveau statut + note explicative facultative. */
export const conflictResolveSchema = z
  .object({
    status: z.enum(CONFLICT_RESOLUTION_STATUS),
    resolutionNote: z.string().trim().max(2000).nullish(),
  })
  .openapi("ConflictResolve");

export type ConflictResolveInput = z.infer<typeof conflictResolveSchema>;

/** Filtres + pagination de la liste des conflits. */
export const conflictListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CONFLICT_STATUS).optional(),
});

export type ConflictListQuery = z.infer<typeof conflictListQuerySchema>;

/** Forme JSON renvoyée par l'API (dates → ISO ; sessions imbriquées). */
export const conflictResponseSchema = z
  .object({
    id: z.string(),
    status: z.enum(CONFLICT_STATUS),
    detectedAt: z.string(),
    resolvedAt: z.string().nullable(),
    resolutionNote: z.string().nullable(),
    /** Les sessions impliquées dans le chevauchement (toujours deux). */
    sessions: z.array(sessionResponseSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Conflict");

export type ConflictResponse = z.infer<typeof conflictResponseSchema>;

/** Résultat d'une passe de détection : compteurs des effets appliqués. */
export const detectionResultSchema = z
  .object({
    /** Nombre de conflits nouvellement ouverts. */
    created: z.number().int(),
    /** Conflits `open` clos automatiquement (chevauchement disparu). */
    autoResolved: z.number().int(),
    /** Total de conflits `open` après la passe. */
    openTotal: z.number().int(),
  })
  .openapi("ConflictDetectionResult");

export type DetectionResult = z.infer<typeof detectionResultSchema>;

// ---------------------------------------------------------------------------
// Enregistrement OpenAPI des routes
// ---------------------------------------------------------------------------

const conflictEnvelope = z.object({ data: conflictResponseSchema });
const conflictListEnvelope = z.object({
  data: z.array(conflictResponseSchema),
  pagination: paginationMetaSchema,
});
const detectionEnvelope = z.object({ data: detectionResultSchema });

registry.registerPath({
  method: "get",
  path: "/conflicts",
  tags: ["Conflicts"],
  summary: "Lister les conflits",
  request: { query: conflictListQuerySchema },
  responses: {
    200: {
      description: "Liste paginée des conflits",
      content: { "application/json": { schema: conflictListEnvelope } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/conflicts/detect",
  tags: ["Conflicts"],
  summary: "Lancer une passe de détection des chevauchements",
  responses: {
    200: {
      description: "Détection effectuée (compteurs des effets appliqués)",
      content: { "application/json": { schema: detectionEnvelope } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/conflicts/{id}",
  tags: ["Conflicts"],
  summary: "Récupérer un conflit",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Conflit",
      content: { "application/json": { schema: conflictEnvelope } },
    },
    404: { description: "Conflit introuvable" },
  },
});

registry.registerPath({
  method: "patch",
  path: "/conflicts/{id}",
  tags: ["Conflicts"],
  summary: "Résoudre ou ignorer un conflit",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: conflictResolveSchema } } },
  },
  responses: {
    200: {
      description: "Conflit mis à jour",
      content: { "application/json": { schema: conflictEnvelope } },
    },
    404: { description: "Conflit introuvable" },
  },
});
