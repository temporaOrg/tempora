/**
 * Hiérarchie d'erreurs métier de l'API.
 *
 * Une erreur lancée n'importe où dans un service ou un handler est rattrapée par
 * `withApi` (voir handler.ts) qui la traduit en réponse JSON via l'enveloppe d'erreur.
 * Le `code` est stable et destiné à être consommé par le front ; le `message` est
 * lisible par un humain. `details` porte le détail de validation Zod le cas échéant.
 */

export type ApiErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "internal_error";

export interface ApiErrorDetail {
  readonly path: string;
  readonly message: string;
}

export abstract class ApiError extends Error {
  abstract readonly status: number;
  abstract readonly code: ApiErrorCode;
  readonly details?: readonly ApiErrorDetail[];

  protected constructor(message: string, details?: readonly ApiErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export class ValidationError extends ApiError {
  readonly status = 422;
  readonly code = "validation_error";

  constructor(message: string, details?: readonly ApiErrorDetail[]) {
    super(message, details);
  }
}

export class UnauthorizedError extends ApiError {
  readonly status = 401;
  readonly code = "unauthorized";

  constructor(message = "Authentification requise.") {
    super(message);
  }
}

export class ForbiddenError extends ApiError {
  readonly status = 403;
  readonly code = "forbidden";

  constructor(message = "Accès refusé.") {
    super(message);
  }
}

export class NotFoundError extends ApiError {
  readonly status = 404;
  readonly code = "not_found";

  constructor(message = "Ressource introuvable.") {
    super(message);
  }
}

export class ConflictError extends ApiError {
  readonly status = 409;
  readonly code = "conflict";

  constructor(message: string, details?: readonly ApiErrorDetail[]) {
    super(message, details);
  }
}
