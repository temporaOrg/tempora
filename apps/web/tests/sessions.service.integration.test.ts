import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createSchool } from "@/lib/services/schools";
import {
  cancelSession,
  createSession,
  detectConflicts,
  getSession,
  listSessions,
  updateSession,
} from "@/lib/services/sessions";
import type { SessionCreateInput } from "@/lib/validators/sessions";

/**
 * Tests d'intégration du service sessions contre la base de dev.
 * Nécessite `tempora-postgres-dev` démarré. Chaque test nettoie ce qu'il crée.
 */

const ACTOR = "test@tempora.local";
const sessionIds: string[] = [];
const schoolIds: string[] = [];

async function makeSchool(rate?: number): Promise<string> {
  const school = await createSchool(
    { name: `ZZ Test ${crypto.randomUUID()}`, defaultHourlyRate: rate },
    ACTOR,
  );
  schoolIds.push(school.id);
  return school.id;
}

async function makeSession(
  input: Omit<SessionCreateInput, "startAt" | "endAt"> & {
    startAt: string;
    endAt: string;
  },
): Promise<string> {
  const session = await createSession(
    {
      ...input,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
    },
    ACTOR,
  );
  sessionIds.push(session.id);
  return session.id;
}

afterEach(async () => {
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

describe("createSession", () => {
  it("hérite du taux par défaut de l'école et calcule le montant facturable", async () => {
    const schoolId = await makeSchool(80);
    const id = await makeSession({
      schoolId,
      title: "Cours",
      startAt: "2026-06-01T09:00:00.000Z",
      endAt: "2026-06-01T12:00:00.000Z",
    });
    const session = await getSession(id);
    expect(session.hourlyRate).toBe("80.00");
    expect(session.billableAmount).toBe("240.00"); // 3h × 80
    expect(session.status).toBe("proposal");
  });

  it("refuse la création sans taux ni taux par défaut sur l'école", async () => {
    const schoolId = await makeSchool(); // pas de taux
    await expect(
      createSession(
        {
          schoolId,
          title: "Sans taux",
          startAt: new Date("2026-06-02T09:00:00.000Z"),
          endAt: new Date("2026-06-02T10:00:00.000Z"),
        },
        ACTOR,
      ),
    ).rejects.toThrow(/taux/i);
  });

  it("lève NotFoundError si l'école n'existe pas", async () => {
    await expect(
      createSession(
        {
          schoolId: "school-inexistant",
          title: "X",
          startAt: new Date("2026-06-02T09:00:00.000Z"),
          endAt: new Date("2026-06-02T10:00:00.000Z"),
        },
        ACTOR,
      ),
    ).rejects.toThrow(/introuvable/i);
  });
});

describe("updateSession", () => {
  it("met à jour le statut et journalise before/after", async () => {
    const schoolId = await makeSchool(80);
    const id = await makeSession({
      schoolId,
      title: "À confirmer",
      startAt: "2026-06-03T09:00:00.000Z",
      endAt: "2026-06-03T11:00:00.000Z",
    });
    const updated = await updateSession(id, { status: "confirmed" }, ACTOR);
    expect(updated.status).toBe("confirmed");

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "session", entityId: id, action: "update" },
    });
    expect(audit?.before).not.toBeNull();
    expect(audit?.after).not.toBeNull();
  });

  it("rejette une reprogrammation aux bornes incohérentes", async () => {
    const schoolId = await makeSchool(80);
    const id = await makeSession({
      schoolId,
      title: "Repro",
      startAt: "2026-06-04T09:00:00.000Z",
      endAt: "2026-06-04T11:00:00.000Z",
    });
    await expect(
      updateSession(id, { endAt: new Date("2026-06-04T08:00:00.000Z") }, ACTOR),
    ).rejects.toThrow();
  });
});

describe("cancelSession", () => {
  it("passe le statut à cancelled et est idempotent", async () => {
    const schoolId = await makeSchool(80);
    const id = await makeSession({
      schoolId,
      title: "À annuler",
      startAt: "2026-06-05T09:00:00.000Z",
      endAt: "2026-06-05T11:00:00.000Z",
    });
    await cancelSession(id, ACTOR);
    const row = await prisma.session.findUnique({ where: { id } });
    expect(row?.status).toBe("cancelled");

    await expect(cancelSession(id, ACTOR)).resolves.toBeUndefined();
  });
});

describe("detectConflicts", () => {
  it("renvoie les sessions actives qui chevauchent le créneau", async () => {
    const schoolId = await makeSchool(80);
    const a = await makeSession({
      schoolId,
      title: "A 9h-12h",
      startAt: "2026-06-10T09:00:00.000Z",
      endAt: "2026-06-10T12:00:00.000Z",
    });
    const b = await makeSession({
      schoolId,
      title: "B 11h-13h (chevauche A)",
      startAt: "2026-06-10T11:00:00.000Z",
      endAt: "2026-06-10T13:00:00.000Z",
    });

    const conflicts = await detectConflicts(a);
    expect(conflicts.map((s) => s.id)).toContain(b);
    expect(conflicts.map((s) => s.id)).not.toContain(a); // s'exclut elle-même
  });

  it("ignore les créneaux contigus (bornes semi-ouvertes)", async () => {
    const schoolId = await makeSchool(80);
    const a = await makeSession({
      schoolId,
      title: "A 9h-10h",
      startAt: "2026-06-11T09:00:00.000Z",
      endAt: "2026-06-11T10:00:00.000Z",
    });
    await makeSession({
      schoolId,
      title: "B 10h-11h (contigu)",
      startAt: "2026-06-11T10:00:00.000Z",
      endAt: "2026-06-11T11:00:00.000Z",
    });

    const conflicts = await detectConflicts(a);
    expect(conflicts).toHaveLength(0);
  });

  it("ignore les sessions annulées", async () => {
    const schoolId = await makeSchool(80);
    const a = await makeSession({
      schoolId,
      title: "A 14h-16h",
      startAt: "2026-06-12T14:00:00.000Z",
      endAt: "2026-06-12T16:00:00.000Z",
    });
    const b = await makeSession({
      schoolId,
      title: "B 15h-17h puis annulée",
      startAt: "2026-06-12T15:00:00.000Z",
      endAt: "2026-06-12T17:00:00.000Z",
    });
    await cancelSession(b, ACTOR);

    const conflicts = await detectConflicts(a);
    expect(conflicts).toHaveLength(0);
  });
});

describe("listSessions", () => {
  it("filtre par école et par fenêtre de dates", async () => {
    const schoolId = await makeSchool(80);
    const inWindow = await makeSession({
      schoolId,
      title: "Dans la fenêtre",
      startAt: "2026-07-01T09:00:00.000Z",
      endAt: "2026-07-01T11:00:00.000Z",
    });
    await makeSession({
      schoolId,
      title: "Hors fenêtre",
      startAt: "2026-08-01T09:00:00.000Z",
      endAt: "2026-08-01T11:00:00.000Z",
    });

    const result = await listSessions({
      page: 1,
      pageSize: 100,
      schoolId,
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-31T00:00:00.000Z"),
    });
    const ids = result.data.map((s) => s.id);
    expect(ids).toContain(inWindow);
    expect(ids).toHaveLength(1);
  });
});
