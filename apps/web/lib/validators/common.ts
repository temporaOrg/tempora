import { z } from "../api/zod";

/**
 * Schémas Zod partagés par plusieurs ressources.
 * Importer `z` depuis `../api/zod` (jamais "zod") pour disposer de `.openapi()`.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Paramètres de pagination, lus depuis la query-string (donc coercés). */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Métadonnée de pagination renvoyée dans les listes (forme OpenAPI). */
export const paginationMetaSchema = z
  .object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .openapi("PaginationMeta");

/** Identifiant de ressource (cuid) passé en paramètre de route. */
export const idParamSchema = z.object({
  id: z.string().min(1, "Identifiant requis."),
});

/**
 * Construit la métadonnée de pagination à partir du total et de la requête.
 */
export function buildPaginationMeta(
  total: number,
  page: number,
  pageSize: number,
): { page: number; pageSize: number; total: number; totalPages: number } {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
