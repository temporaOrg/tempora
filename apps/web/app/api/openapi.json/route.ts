import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { buildOpenApiDocument } from "@/lib/api/openapi";

// Importer les modules de validateurs pour leur effet de bord : chacun enregistre
// ses schémas et ses routes sur le registre OpenAPI au chargement. Sans ces imports,
// le document serait vide. Ajouter ici chaque nouvelle ressource.
import "@/lib/validators/schools";
import "@/lib/validators/sessions";
import "@/lib/validators/conflicts";

/**
 * Contrat OpenAPI de l'API, dérivé des schémas Zod (source unique de vérité).
 * Consommé par le front pour générer ses clients/typings (approche API-first).
 * Endpoint public : un contrat n'expose aucune donnée métier.
 */
export const GET = withApi(async () => {
  return NextResponse.json(buildOpenApiDocument());
});
