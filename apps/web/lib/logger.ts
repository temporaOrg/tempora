import pino from "pino";

/**
 * Logger structuré JSON (CLAUDE.md §4.10).
 *
 * Niveau piloté par LOG_LEVEL (défaut `info`). En développement, pino-pretty
 * rend les logs lisibles ; en production on émet du JSON brut, agrégé sur le NAS.
 *
 * Filtre PII : ne jamais logger mot de passe, token ou donnée client sensible.
 * Les champs ci-dessous sont systématiquement caviardés s'ils apparaissent.
 */
const REDACTED_PATHS = [
  "password",
  "passwordHash",
  "*.password",
  "*.passwordHash",
  "authorization",
  "*.authorization",
  "token",
  "*.token",
];

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
  ...(isProduction
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true } } }),
});
