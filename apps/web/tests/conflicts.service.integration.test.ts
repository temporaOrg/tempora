import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createSchool } from "@/lib/services/schools";
import { cancelSession, createSession } from "@/lib/services/sessions";
import {
  getConflict,
  listConflicts,
  resolveConflict,
  runDetection,
} from "@/lib/services/conflicts";

/**
 * Tests d'intégration du service conflicts contre la base de dev.
 * Nécessite `tempora-postgres-dev` démarré.
 *
 * runDetection est GLOBAL (il scanne toute la base, y compris le seed). Pour
 * rester déterministe : on capture les conflits préexistants en début de suite
 * et on ne nettoie que ce que la détection a créé en plus ; les assertions ne
 * portent que sur les conflits impliquant les sessions du test.
 */

const ACTOR = "test@tempora.local";
const sessionIds: string[] = [];
const schoolIds: string[] = [];
let preExistingConflictIds: Set<string>;

beforeAll(async () => {
  const rows = await prisma.conflict.findMany({ select: { id: true } });
  preExistingConflictIds = new Set(rows.map((r) => r.id));
});

async function makeSchool(): Promise<string> {
  const school = await createSchool(
    { name: `ZZ Test ${crypto.randomUUID()}`, defaultHourlyRate: 80 },
    ACTOR,
  );
  schoolIds.push(school.id);
  return school.id;
}

async function makeSession(
  schoolId: string,
  title: string,
  startAt: string,
  endAt: string,
): Promise<string> {
  const session = await createSession(
    {
      schoolId,
      title,
      startAt: new Date(startAt),
      endAt: new Date(endAt),
    },
    ACTOR,
  );
  sessionIds.push(session.id);
  return session.id;
}

/** Conflits (impliquant les sessions du test) chargés avec leurs sessions. */
async function myConflicts() {
  return prisma.conflict.findMany({
    where: { conflictSessions: { some: { sessionId: { in: sessionIds } } } },
    include: { conflictSessions: { select: { sessionId: true } } },
  });
}

/** L'unique conflit attendu pour les sessions du test (échoue s'il est absent). */
async function mySoleConflict() {
  const [conflict] = await myConflicts();
  if (!conflict) throw new Error("aucun conflit pour les sessions du test");
  return conflict;
}

afterEach(async () => {
  // Tout conflit apparu pendant le test (mes paires + d'éventuelles paires du seed).
  const rows = await prisma.conflict.findMany({ select: { id: true } });
  const newConflictIds = rows
    .map((r) => r.id)
    .filter((id) => !preExistingConflictIds.has(id));
  if (newConflictIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entityType: "conflict", entityId: { in: newConflictIds } },
    });
    // La suppression du conflit cascade sur conflict_sessions.
    await prisma.conflict.deleteMany({ where: { id: { in: newConflictIds } } });
  }

  if (sessionIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entityType: "session", entityId: { in: sessionIds } },
    });
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
    sessionIds.length = 0;
  }
  if (schoolIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entityType: "school", entityId: { in: schoolIds } },
    });
    await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
    schoolIds.length = 0;
  }
});

describe("runDetection", () => {
  it("matérialise un conflit ouvert pour deux sessions qui se chevauchent", async () => {
    const schoolId = await makeSchool();
    const a = await makeSession(
      schoolId,
      "A 9h-12h",
      "2027-03-01T09:00:00.000Z",
      "2027-03-01T12:00:00.000Z",
    );
    const b = await makeSession(
      schoolId,
      "B 11h-13h",
      "2027-03-01T11:00:00.000Z",
      "2027-03-01T13:00:00.000Z",
    );

    await runDetection(ACTOR);

    expect(await myConflicts()).toHaveLength(1);
    const conflict = await mySoleConflict();
    expect(conflict.status).toBe("open");
    const sessionsInConflict = conflict.conflictSessions
      .map((cs) => cs.sessionId)
      .sort();
    expect(sessionsInConflict).toEqual([a, b].sort());

    // Le DTO expose bien les deux sessions imbriquées.
    const dto = await getConflict(conflict.id);
    expect(dto.sessions).toHaveLength(2);
    expect(dto.sessions.map((s) => s.id).sort()).toEqual([a, b].sort());
  });

  it("ne crée pas de doublon si relancée sans changement (idempotente)", async () => {
    const schoolId = await makeSchool();
    await makeSession(
      schoolId,
      "A",
      "2027-03-02T09:00:00.000Z",
      "2027-03-02T11:00:00.000Z",
    );
    await makeSession(
      schoolId,
      "B",
      "2027-03-02T10:00:00.000Z",
      "2027-03-02T12:00:00.000Z",
    );

    await runDetection(ACTOR);
    await runDetection(ACTOR);

    expect(await myConflicts()).toHaveLength(1);
  });

  it("ignore les créneaux contigus (aucun conflit)", async () => {
    const schoolId = await makeSchool();
    await makeSession(
      schoolId,
      "A 9h-10h",
      "2027-03-03T09:00:00.000Z",
      "2027-03-03T10:00:00.000Z",
    );
    await makeSession(
      schoolId,
      "B 10h-11h",
      "2027-03-03T10:00:00.000Z",
      "2027-03-03T11:00:00.000Z",
    );

    await runDetection(ACTOR);

    expect(await myConflicts()).toHaveLength(0);
  });

  it("referme automatiquement un conflit ouvert quand une session est annulée", async () => {
    const schoolId = await makeSchool();
    await makeSession(
      schoolId,
      "A",
      "2027-03-04T09:00:00.000Z",
      "2027-03-04T12:00:00.000Z",
    );
    const b = await makeSession(
      schoolId,
      "B",
      "2027-03-04T11:00:00.000Z",
      "2027-03-04T13:00:00.000Z",
    );

    await runDetection(ACTOR);
    expect((await mySoleConflict()).status).toBe("open");

    await cancelSession(b, ACTOR);
    const result = await runDetection(ACTOR);
    expect(result.autoResolved).toBeGreaterThanOrEqual(1);

    expect(await myConflicts()).toHaveLength(1);
    expect((await mySoleConflict()).status).toBe("resolved");
  });
});

describe("resolveConflict", () => {
  it("passe le conflit à resolved, horodate et journalise resolve_conflict", async () => {
    const schoolId = await makeSchool();
    await makeSession(
      schoolId,
      "A",
      "2027-03-05T09:00:00.000Z",
      "2027-03-05T12:00:00.000Z",
    );
    await makeSession(
      schoolId,
      "B",
      "2027-03-05T11:00:00.000Z",
      "2027-03-05T13:00:00.000Z",
    );
    await runDetection(ACTOR);
    const id = (await mySoleConflict()).id;

    const resolved = await resolveConflict(
      id,
      { status: "resolved", resolutionNote: "Traité manuellement." },
      ACTOR,
    );
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.resolutionNote).toBe("Traité manuellement.");

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: "conflict",
        entityId: id,
        action: "resolve_conflict",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("lève NotFoundError sur un conflit inexistant", async () => {
    await expect(
      resolveConflict("conflit-inexistant", { status: "ignored" }, ACTOR),
    ).rejects.toThrow(/introuvable/i);
  });

  it("un conflit ignoré n'est pas rouvert par une nouvelle détection", async () => {
    const schoolId = await makeSchool();
    await makeSession(
      schoolId,
      "A",
      "2027-03-06T09:00:00.000Z",
      "2027-03-06T12:00:00.000Z",
    );
    await makeSession(
      schoolId,
      "B",
      "2027-03-06T11:00:00.000Z",
      "2027-03-06T13:00:00.000Z",
    );
    await runDetection(ACTOR);
    const id = (await mySoleConflict()).id;
    await resolveConflict(id, { status: "ignored" }, ACTOR);

    await runDetection(ACTOR);

    expect(await myConflicts()).toHaveLength(1);
    expect((await mySoleConflict()).status).toBe("ignored");
  });
});

describe("listConflicts", () => {
  it("filtre par statut", async () => {
    const schoolId = await makeSchool();
    await makeSession(
      schoolId,
      "A",
      "2027-03-07T09:00:00.000Z",
      "2027-03-07T12:00:00.000Z",
    );
    await makeSession(
      schoolId,
      "B",
      "2027-03-07T11:00:00.000Z",
      "2027-03-07T13:00:00.000Z",
    );
    await runDetection(ACTOR);
    const id = (await mySoleConflict()).id;

    const open = await listConflicts({ page: 1, pageSize: 100, status: "open" });
    expect(open.data.some((c) => c.id === id)).toBe(true);

    const resolved = await listConflicts({
      page: 1,
      pageSize: 100,
      status: "resolved",
    });
    expect(resolved.data.some((c) => c.id === id)).toBe(false);
  });
});
