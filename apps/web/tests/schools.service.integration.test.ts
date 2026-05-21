import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  archiveSchool,
  createSchool,
  getSchool,
  listSchools,
  updateSchool,
} from "@/lib/services/schools";

/**
 * Tests d'intégration du service schools contre la base de dev (docker-compose.dev.yml).
 * Nécessite `tempora-postgres-dev` démarré. Chaque test nettoie ce qu'il crée.
 */

const ACTOR = "test@tempora.local";
const createdIds: string[] = [];

async function track<T extends { id: string }>(promise: Promise<T>): Promise<T> {
  const entity = await promise;
  createdIds.push(entity.id);
  return entity;
}

afterEach(async () => {
  if (createdIds.length === 0) return;
  await prisma.auditLog.deleteMany({
    where: { entityType: "school", entityId: { in: createdIds } },
  });
  await prisma.school.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
});

describe("createSchool", () => {
  it("crée une école avec le pays par défaut FR et journalise un audit", async () => {
    const school = await track(
      createSchool({ name: "Test Vinci", defaultHourlyRate: 75 }, ACTOR),
    );
    expect(school.country).toBe("FR");
    expect(school.defaultHourlyRate).toBe("75.00");
    expect(school.isArchived).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "school", entityId: school.id, action: "create" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actor).toBe(ACTOR);
  });
});

describe("getSchool", () => {
  it("renvoie l'école existante", async () => {
    const created = await track(createSchool({ name: "Test Get" }, ACTOR));
    const fetched = await getSchool(created.id);
    expect(fetched.id).toBe(created.id);
  });

  it("lève NotFoundError pour un id inconnu", async () => {
    await expect(getSchool("id-inexistant")).rejects.toThrow(/introuvable/i);
  });
});

describe("updateSchool", () => {
  it("met à jour partiellement et journalise before/after", async () => {
    const created = await track(createSchool({ name: "Test Update" }, ACTOR));
    const updated = await updateSchool(created.id, { city: "Paris" }, ACTOR);
    expect(updated.city).toBe("Paris");
    expect(updated.name).toBe("Test Update");

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "school", entityId: created.id, action: "update" },
    });
    expect(audit?.before).not.toBeNull();
    expect(audit?.after).not.toBeNull();
  });
});

describe("archiveSchool", () => {
  it("archive (soft-delete) sans supprimer la ligne", async () => {
    const created = await track(createSchool({ name: "Test Archive" }, ACTOR));
    await archiveSchool(created.id, ACTOR);

    const row = await prisma.school.findUnique({ where: { id: created.id } });
    expect(row?.isArchived).toBe(true);
  });

  it("est idempotent sur une école déjà archivée", async () => {
    const created = await track(createSchool({ name: "Test Idem" }, ACTOR));
    await archiveSchool(created.id, ACTOR);
    await expect(archiveSchool(created.id, ACTOR)).resolves.toBeUndefined();
  });
});

describe("listSchools", () => {
  it("exclut les archivées par défaut et les inclut sur demande", async () => {
    const active = await track(createSchool({ name: "ZZ Active List" }, ACTOR));
    const archived = await track(
      createSchool({ name: "ZZ Archived List" }, ACTOR),
    );
    await archiveSchool(archived.id, ACTOR);

    const defaultList = await listSchools({
      page: 1,
      pageSize: 100,
      includeArchived: false,
    });
    const ids = defaultList.data.map((s) => s.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(archived.id);

    const withArchived = await listSchools({
      page: 1,
      pageSize: 100,
      includeArchived: true,
    });
    expect(withArchived.data.map((s) => s.id)).toContain(archived.id);
  });
});
