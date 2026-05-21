import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";

/**
 * Registre OpenAPI central (approche API-first, CLAUDE.md §2).
 *
 * Chaque module de validateurs enregistre ses schémas et ses routes sur ce
 * registre. Le document OpenAPI est ensuite dérivé des MÊMES schémas Zod qui
 * valident les requêtes : une seule source de vérité, jamais désynchronisée.
 * Le document est servi par GET /api/openapi.json et consommé par le front.
 */
export const registry = new OpenAPIRegistry();

export function buildOpenApiDocument(): ReturnType<
  OpenApiGeneratorV3["generateDocument"]
> {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Tempora API",
      version: "0.1.0",
      description:
        "API métier de Tempora — orchestration de l'activité d'un formateur indépendant.",
    },
    servers: [{ url: "/api" }],
  });
}
