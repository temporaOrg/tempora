import { withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/api/auth";
import { ok } from "@/lib/api/response";
import { runDetection } from "@/lib/services/conflicts";

/**
 * Déclenche une passe de détection des chevauchements. POST car l'opération a
 * des effets de bord (création / clôture de conflits). Le segment statique
 * `detect` prime sur `[id]` côté routeur : aucune ambiguïté avec GET /conflicts/{id}.
 */
export const POST = withApi(async () => {
  const actor = requireAuth();
  const result = await runDetection(actor.email);
  return ok(result);
});
