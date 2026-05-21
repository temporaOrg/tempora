import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "../lib/db";
import { findOverlappingSessions } from "../lib/conflicts";

async function makeSchool() {
  return prisma.school.create({ data: { name: "École Test" } });
}

describe("findOverlappingSessions (intégration Postgres)", () => {
  beforeEach(async () => {
    // Nettoyage : ordre respectant les FK.
    await prisma.conflictSession.deleteMany();
    await prisma.session.deleteMany();
    await prisma.school.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("trouve une session existante qui chevauche le créneau demandé", async () => {
    const school = await makeSchool();
    await prisma.session.create({
      data: {
        schoolId: school.id,
        title: "Cours A",
        startAt: new Date("2026-06-01T09:00:00Z"),
        endAt: new Date("2026-06-01T11:00:00Z"),
        hourlyRate: "50.00",
        status: "confirmed",
      },
    });

    const hits = await findOverlappingSessions(
      new Date("2026-06-01T10:00:00Z"),
      new Date("2026-06-01T12:00:00Z"),
    );
    expect(hits).toHaveLength(1);
  });

  it("ignore les créneaux contigus (pas de chevauchement)", async () => {
    const school = await makeSchool();
    await prisma.session.create({
      data: {
        schoolId: school.id,
        title: "Cours A",
        startAt: new Date("2026-06-01T09:00:00Z"),
        endAt: new Date("2026-06-01T10:00:00Z"),
        hourlyRate: "50.00",
        status: "confirmed",
      },
    });

    const hits = await findOverlappingSessions(
      new Date("2026-06-01T10:00:00Z"),
      new Date("2026-06-01T11:00:00Z"),
    );
    expect(hits).toHaveLength(0);
  });

  it("ignore les sessions annulées", async () => {
    const school = await makeSchool();
    await prisma.session.create({
      data: {
        schoolId: school.id,
        title: "Cours annulé",
        startAt: new Date("2026-06-01T09:00:00Z"),
        endAt: new Date("2026-06-01T11:00:00Z"),
        hourlyRate: "50.00",
        status: "cancelled",
      },
    });

    const hits = await findOverlappingSessions(
      new Date("2026-06-01T10:00:00Z"),
      new Date("2026-06-01T12:00:00Z"),
    );
    expect(hits).toHaveLength(0);
  });

  it("exclut la session passée en excludeId", async () => {
    const school = await makeSchool();
    const s = await prisma.session.create({
      data: {
        schoolId: school.id,
        title: "Cours A",
        startAt: new Date("2026-06-01T09:00:00Z"),
        endAt: new Date("2026-06-01T11:00:00Z"),
        hourlyRate: "50.00",
        status: "confirmed",
      },
    });

    const hits = await findOverlappingSessions(
      new Date("2026-06-01T09:00:00Z"),
      new Date("2026-06-01T11:00:00Z"),
      s.id,
    );
    expect(hits).toHaveLength(0);
  });
});
