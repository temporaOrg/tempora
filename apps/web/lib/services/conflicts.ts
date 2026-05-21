import { prisma } from "../db";
import { Prisma, type ConflictStatus } from "../generated/prisma/client";
import { ConflictError, NotFoundError } from "../api/errors";
import { recordAudit } from "../audit";
import { findOverlappingPairs } from "../conflicts";
import { toResponse as sessionToResponse } from "./sessions";
import { buildPaginationMeta } from "../validators/common";
import type { PaginationMeta } from "../api/response";
import type {
  ConflictListQuery,
  ConflictResolveInput,
  ConflictResponse,
  DetectionResult,
} from "../validators/conflicts";

/**
 * Logique métier de la ressource `conflicts`.
 *
 * Un conflit est la matérialisation d'un chevauchement horaire entre deux
 * sessions actives. La détection (`runDetection`) crée les conflits manquants et
 * referme ceux dont le chevauchement a disparu ; le formateur tranche les
 * conflits restants via `resolveConflict`. La détection ponctuelle, elle, vit
 * dans le service `sessions` (lecture autour d'une seule session).
 */

const ENTITY_TYPE = "conflict";

/** Conflit chargé avec ses sessions imbriquées (forme attendue par toResponse). */
type ConflictWithSessions = Prisma.ConflictGetPayload<{
  include: { conflictSessions: { include: { session: true } } };
}>;

const withSessions = {
  conflictSessions: { include: { session: true } },
} as const;

/** Clé d'identité d'une paire, indépendante de l'ordre des deux sessions. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Clé de paire d'un conflit existant, ou `null` s'il ne lie pas exactement deux
 * sessions (cas qui ne devrait pas se produire : on ne crée que des paires).
 */
function conflictPairKey(
  conflictSessions: readonly { sessionId: string }[],
): string | null {
  const [first, second] = conflictSessions;
  if (!first || !second || conflictSessions.length !== 2) return null;
  return pairKey(first.sessionId, second.sessionId);
}

/** Mappe un conflit Prisma (+ ses sessions) vers la forme JSON exposée. */
function toResponse(conflict: ConflictWithSessions): ConflictResponse {
  return {
    id: conflict.id,
    status: conflict.status,
    detectedAt: conflict.detectedAt.toISOString(),
    resolvedAt: conflict.resolvedAt ? conflict.resolvedAt.toISOString() : null,
    resolutionNote: conflict.resolutionNote,
    sessions: conflict.conflictSessions.map((cs) =>
      sessionToResponse(cs.session),
    ),
    createdAt: conflict.createdAt.toISOString(),
    updatedAt: conflict.updatedAt.toISOString(),
  };
}

export async function listConflicts(query: ConflictListQuery): Promise<{
  data: ConflictResponse[];
  pagination: PaginationMeta;
}> {
  const where: Prisma.ConflictWhereInput = query.status
    ? { status: query.status }
    : {};

  const [rows, total] = await Promise.all([
    prisma.conflict.findMany({
      where,
      include: withSessions,
      orderBy: { detectedAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.conflict.count({ where }),
  ]);

  return {
    data: rows.map(toResponse),
    pagination: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function getConflict(id: string): Promise<ConflictResponse> {
  const conflict = await prisma.conflict.findUnique({
    where: { id },
    include: withSessions,
  });
  if (!conflict) {
    throw new NotFoundError("Conflit introuvable.");
  }
  return toResponse(conflict);
}

/**
 * Tranche un conflit : statut `resolved` ou `ignored`, horodatage de résolution
 * et note facultative. Action critique tracée (`resolve_conflict`).
 */
export async function resolveConflict(
  id: string,
  input: ConflictResolveInput,
  actor: string,
): Promise<ConflictResponse> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.conflict.findUnique({
      where: { id },
      include: withSessions,
    });
    if (!existing) {
      throw new NotFoundError("Conflit introuvable.");
    }
    // Seul un conflit ouvert se tranche : rejouer une résolution sur un conflit
    // déjà clos n'aurait pas de sens et polluerait le journal d'audit (409).
    if (existing.status !== "open") {
      throw new ConflictError("Ce conflit est déjà résolu ou ignoré.");
    }

    const updated = await tx.conflict.update({
      where: { id },
      data: {
        status: input.status,
        resolvedAt: new Date(),
        resolutionNote: input.resolutionNote ?? null,
      },
      include: withSessions,
    });

    const dto = toResponse(updated);
    await recordAudit(
      {
        actor,
        action: "resolve_conflict",
        entityType: ENTITY_TYPE,
        entityId: id,
        before: toResponse(existing),
        after: dto,
      },
      tx,
    );
    return dto;
  });
}

/**
 * Passe de détection globale (déclenchée par n8n ou le front) :
 *  - ouvre un conflit pour chaque paire de sessions actives qui se chevauchent
 *    et n'a pas déjà un conflit non résolu (`open` ou `ignored`) ;
 *  - referme automatiquement les conflits `open` dont le chevauchement a disparu
 *    (session reprogrammée ou annulée). Les `ignored` ne sont jamais touchés.
 *
 * Choix produit assumé : `ignored` est définitif *pour cette paire de sessions*.
 * Un chevauchement délibérément ignoré ne ressurgit pas, même s'il disparaît
 * puis réapparaît — « j'ai acté que ces deux sessions se télescopent, ne me
 * redemande plus ». La clé de déduplication porte sur les ID de sessions, pas
 * sur l'instant du chevauchement.
 *
 * Concurrence : lectures et écritures dans une seule transaction, précédée d'un
 * verrou consultatif Postgres. Deux passes simultanées (cron n8n + déclenchement
 * manuel) sont sérialisées — sans quoi elles pourraient créer le conflit en
 * double (aucune contrainte d'unicité sur la paire).
 *
 * Idempotente : relancée sans changement de données, elle ne crée rien.
 */
export async function runDetection(actor: string): Promise<DetectionResult> {
  const { created, autoResolved } = await prisma.$transaction(async (tx) => {
    // Sérialise les passes de détection concurrentes (libéré en fin de transaction).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tempora_conflict_detection'))`;

    const pairs = await findOverlappingPairs(tx);
    const currentKeys = new Set(pairs.map((p) => pairKey(p.aId, p.bId)));

    // Conflits déjà connus, avec leurs deux sessions, indexés par clé de paire.
    const known = await tx.conflict.findMany({
      where: { status: { in: ["open", "ignored"] } },
      include: { conflictSessions: { select: { sessionId: true } } },
    });
    const knownKeys = new Set(
      known
        .map((c) => conflictPairKey(c.conflictSessions))
        .filter((key): key is string => key !== null),
    );
    const staleOpen = known.filter((c) => {
      if (c.status !== "open") return false;
      const key = conflictPairKey(c.conflictSessions);
      return key !== null && !currentKeys.has(key);
    });

    const toCreate = pairs.filter((p) => !knownKeys.has(pairKey(p.aId, p.bId)));

    for (const pair of toCreate) {
      const conflict = await tx.conflict.create({
        data: {
          status: "open",
          conflictSessions: {
            create: [{ sessionId: pair.aId }, { sessionId: pair.bId }],
          },
        },
      });
      await recordAudit(
        {
          actor,
          action: "create",
          entityType: ENTITY_TYPE,
          entityId: conflict.id,
          after: { status: "open", sessionIds: [pair.aId, pair.bId] },
        },
        tx,
      );
    }

    for (const conflict of staleOpen) {
      await tx.conflict.update({
        where: { id: conflict.id },
        data: {
          status: "resolved",
          resolvedAt: new Date(),
          resolutionNote: "Résolu automatiquement : plus de chevauchement.",
        },
      });
      await recordAudit(
        {
          actor,
          action: "resolve_conflict",
          entityType: ENTITY_TYPE,
          entityId: conflict.id,
          before: { status: "open" as ConflictStatus },
          after: { status: "resolved" as ConflictStatus, auto: true },
        },
        tx,
      );
    }

    return { created: toCreate.length, autoResolved: staleOpen.length };
  });

  const openTotal = await prisma.conflict.count({ where: { status: "open" } });

  return { created, autoResolved, openTotal };
}
