import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "./zod";
import { logger } from "../logger";
import {
  ApiError,
  ValidationError,
  type ApiErrorDetail,
} from "./errors";
import { errorResponse } from "./response";

/**
 * Wrapper de tout handler de route API.
 *
 * Responsabilités transverses, centralisées une seule fois :
 *  - try/catch global : aucune exception ne fuit en stacktrace brute au client ;
 *  - traduction des erreurs en enveloppe JSON cohérente (errors.ts → response.ts) ;
 *  - mapping des `ZodError` (validation) en 422 structuré ;
 *  - log structuré de la requête et des erreurs (sans PII).
 *
 * Les handlers se réduisent ainsi à : valider → appeler le service → formater.
 */
export type RouteHandler<Ctx> = (
  req: NextRequest,
  ctx: Ctx,
) => Promise<NextResponse> | NextResponse;

function zodErrorToValidationError(error: ZodError): ValidationError {
  const details: ApiErrorDetail[] = error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join(".") || "(racine)",
    message: issue.message,
  }));
  return new ValidationError("La requête est invalide.", details);
}

export function withApi<Ctx = unknown>(
  handler: RouteHandler<Ctx>,
): RouteHandler<Ctx> {
  return async (req, ctx) => {
    const start = Date.now();
    try {
      const response = await handler(req, ctx);
      logger.info(
        { method: req.method, path: req.nextUrl.pathname, status: response.status, durationMs: Date.now() - start },
        "api_request",
      );
      return response;
    } catch (caught) {
      const error =
        caught instanceof ZodError
          ? zodErrorToValidationError(caught)
          : caught;

      if (error instanceof ApiError) {
        // Erreurs métier attendues : on log en warn, pas d'alerte.
        logger.warn(
          { method: req.method, path: req.nextUrl.pathname, status: error.status, code: error.code, durationMs: Date.now() - start },
          "api_error",
        );
        return errorResponse(error);
      }

      // Erreur non maîtrisée : log complet côté serveur, message générique au client.
      logger.error(
        { method: req.method, path: req.nextUrl.pathname, err: error, durationMs: Date.now() - start },
        "api_unhandled_error",
      );
      return NextResponse.json(
        { error: { code: "internal_error", message: "Une erreur interne est survenue." } },
        { status: 500 },
      );
    }
  };
}
