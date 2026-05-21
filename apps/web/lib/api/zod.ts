import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

/**
 * Point d'entrée unique de Zod pour toute l'application.
 *
 * `extendZodWithOpenApi` ajoute la méthode `.openapi()` au prototype Zod. Il DOIT
 * s'exécuter avant tout appel à `.openapi()`. En important systématiquement `z`
 * depuis ce module (et jamais directement depuis "zod"), on garantit cet ordre.
 */
extendZodWithOpenApi(z);

export { z };
