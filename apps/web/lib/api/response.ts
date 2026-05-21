import { NextResponse } from "next/server";
import type { ApiError, ApiErrorCode, ApiErrorDetail } from "./errors";

/**
 * Enveloppes de réponse uniformes pour toute l'API.
 *
 * Succès simple   : { data: T }
 * Succès paginé    : { data: T[], pagination: PaginationMeta }
 * Erreur           : { error: { code, message, details? } }
 *
 * Cette uniformité est ce sur quoi le front s'appuiera, et alimente l'OpenAPI.
 */

export interface PaginationMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface ErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details?: readonly ApiErrorDetail[];
  };
}

export function ok<T>(data: T): NextResponse {
  return NextResponse.json({ data });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ data }, { status: 201 });
}

export function paginated<T>(
  data: readonly T[],
  pagination: PaginationMeta,
): NextResponse {
  return NextResponse.json({ data, pagination });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function errorResponse(error: ApiError): NextResponse {
  const body: ErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  };
  return NextResponse.json(body, { status: error.status });
}
