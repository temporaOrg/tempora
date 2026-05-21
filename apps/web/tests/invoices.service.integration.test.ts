import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createSchool } from "@/lib/services/schools";
import { createSession } from "@/lib/services/sessions";
import {
  cancelInvoice,
  generateInvoice,
  getInvoice,
  listInvoices,
  updateInvoice,
} from "@/lib/services/invoices";

/**
 * Tests d'intégration du service invoices contre la base de dev.
 * Nécessite `tempora-postgres-dev` démarré.
 *
 * On travaille en dates lointaines (2027) et on nettoie tout ce qu'on crée.
 */

const ACTOR = "test@tempora.local";
const sessionIds: string[] = [];
const schoolIds: string[] = [];
const invoiceIds: string[] = [];

async function makeSchool(): Promise<string> {
  const school = await createSchool(
    { name: `ZZ Test ${crypto.randomUUID()}`, defaultHourlyRate: 80 },
    ACTOR,
  );
  schoolIds.push(school.id);
  return school.id;
}

async function makeConfirmedSession(
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
      status: "confirmed",
    },
    ACTOR,
  );
  sessionIds.push(session.id);
  return session.id;
}

async function generate(
  schoolId: string,
  periodStart: string,
  periodEnd: string,
) {
  const invoice = await generateInvoice(
    {
      schoolId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
    },
    ACTOR,
  );
  invoiceIds.push(invoice.id);
  return invoice;
}

afterEach(async () => {
  // Sessions d'abord (lèvent la FK invoiceId), puis factures (cascade lignes).
  if (sessionIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entityType: "session", entityId: { in: sessionIds } },
    });
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
    sessionIds.length = 0;
  }
  if (invoiceIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entityType: "invoice", entityId: { in: invoiceIds } },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    invoiceIds.length = 0;
  }
  if (schoolIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entityType: "school", entityId: { in: schoolIds } },
    });
    await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
    schoolIds.length = 0;
  }
});

describe("generateInvoice", () => {
  it("agrège les sessions confirmées de la période en lignes figées", async () => {
    const schoolId = await makeSchool();
    const a = await makeConfirmedSession(
      schoolId,
      "Cours A",
      "2027-06-03T09:00:00.000Z",
      "2027-06-03T12:00:00.000Z", // 3h × 80 = 240
    );
    const b = await makeConfirmedSession(
      schoolId,
      "Cours B",
      "2027-06-10T14:00:00.000Z",
      "2027-06-10T16:00:00.000Z", // 2h × 80 = 160
    );

    const invoice = await generate(schoolId, "2027-06-01", "2027-07-01");

    expect(invoice.status).toBe("draft");
    expect(invoice.currency).toBe("EUR");
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.sessionIds.sort()).toEqual([a, b].sort());
    expect(invoice.subtotal).toBe("400.00");
    expect(invoice.taxAmount).toBe("0.00");
    expect(invoice.total).toBe("400.00");

    // Les sessions sont figées en `invoiced` et pointent la facture.
    const sessions = await prisma.session.findMany({
      where: { id: { in: [a, b] } },
    });
    expect(sessions.every((s) => s.status === "invoiced")).toBe(true);
    expect(sessions.every((s) => s.invoiceId === invoice.id)).toBe(true);
  });

  it("n'inclut que les sessions confirmées de la période", async () => {
    const schoolId = await makeSchool();
    const inScope = await makeConfirmedSession(
      schoolId,
      "Dans la période",
      "2027-06-15T09:00:00.000Z",
      "2027-06-15T11:00:00.000Z",
    );
    // Proposal (pas confirmée) dans la période → ignorée.
    const proposal = await createSession(
      {
        schoolId,
        title: "Proposition",
        startAt: new Date("2027-06-16T09:00:00.000Z"),
        endAt: new Date("2027-06-16T11:00:00.000Z"),
        status: "proposal",
      },
      ACTOR,
    );
    sessionIds.push(proposal.id);
    // Confirmée mais hors période → ignorée.
    await makeConfirmedSession(
      schoolId,
      "Hors période",
      "2027-07-02T09:00:00.000Z",
      "2027-07-02T11:00:00.000Z",
    );

    const invoice = await generate(schoolId, "2027-06-01", "2027-07-01");

    expect(invoice.sessionIds).toEqual([inScope]);
  });

  it("lève ValidationError si aucune session confirmée sur la période", async () => {
    const schoolId = await makeSchool();
    await expect(
      generate(schoolId, "2027-06-01", "2027-07-01"),
    ).rejects.toThrow(/aucune session confirmée/i);
  });

  it("lève NotFoundError si l'école n'existe pas", async () => {
    await expect(
      generate("school-inexistante", "2027-06-01", "2027-07-01"),
    ).rejects.toThrow(/introuvable/i);
  });

  it("date l'intitulé de ligne dans le fuseau du formateur (Europe/Paris)", async () => {
    const schoolId = await makeSchool();
    // 22:30 UTC le 3 juin = 00:30 le 4 juin à Paris (été, +02:00).
    await makeConfirmedSession(
      schoolId,
      "Cours du soir",
      "2027-06-03T22:30:00.000Z",
      "2027-06-03T23:30:00.000Z",
    );

    const invoice = await generate(schoolId, "2027-06-01", "2027-07-01");

    expect(invoice.lines[0]?.label).toContain("(2027-06-04)");
  });
});

describe("updateInvoice", () => {
  async function draftInvoice(): Promise<string> {
    const schoolId = await makeSchool();
    await makeConfirmedSession(
      schoolId,
      "Cours",
      "2027-08-03T09:00:00.000Z",
      "2027-08-03T12:00:00.000Z",
    );
    const invoice = await generate(schoolId, "2027-08-01", "2027-09-01");
    return invoice.id;
  }

  it("émet la facture (draft → issued), horodate et journalise issue_invoice", async () => {
    const id = await draftInvoice();

    const issued = await updateInvoice(
      id,
      { status: "issued", number: "F-2027-001", pennylaneId: "pl_42" },
      ACTOR,
    );
    expect(issued.status).toBe("issued");
    expect(issued.issuedAt).not.toBeNull();
    expect(issued.number).toBe("F-2027-001");
    expect(issued.pennylaneId).toBe("pl_42");

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "invoice", entityId: id, action: "issue_invoice" },
    });
    expect(audit).not.toBeNull();
  });

  it("horodate paidAt au passage à paid", async () => {
    const id = await draftInvoice();
    await updateInvoice(id, { status: "issued" }, ACTOR);
    const paid = await updateInvoice(id, { status: "paid" }, ACTOR);
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).not.toBeNull();
  });

  it("refuse une transition interdite (draft → paid)", async () => {
    const id = await draftInvoice();
    await expect(
      updateInvoice(id, { status: "paid" }, ACTOR),
    ).rejects.toThrow(/transition de statut interdite/i);
  });

  it("n'horodate pas paidAt sur un PATCH de métadonnées sans transition paid", async () => {
    const id = await draftInvoice();
    await updateInvoice(id, { status: "issued" }, ACTOR);
    // Réécriture Pennylane seule (pas de status) : paidAt doit rester nul.
    const updated = await updateInvoice(
      id,
      { pennylaneId: "pl_meta", paidAt: new Date("2027-08-15T00:00:00.000Z") },
      ACTOR,
    );
    expect(updated.status).toBe("issued");
    expect(updated.paidAt).toBeNull();
  });
});

describe("cancelInvoice", () => {
  it("annule un brouillon et libère ses sessions", async () => {
    const schoolId = await makeSchool();
    const s = await makeConfirmedSession(
      schoolId,
      "Cours",
      "2027-09-03T09:00:00.000Z",
      "2027-09-03T12:00:00.000Z",
    );
    const invoice = await generate(schoolId, "2027-09-01", "2027-10-01");

    await cancelInvoice(invoice.id, ACTOR);

    const cancelled = await getInvoice(invoice.id);
    expect(cancelled.status).toBe("cancelled");

    const session = await prisma.session.findUniqueOrThrow({ where: { id: s } });
    expect(session.status).toBe("confirmed");
    expect(session.invoiceId).toBeNull();
  });

  it("refuse d'annuler une facture émise (avoir requis)", async () => {
    const schoolId = await makeSchool();
    await makeConfirmedSession(
      schoolId,
      "Cours",
      "2027-10-03T09:00:00.000Z",
      "2027-10-03T12:00:00.000Z",
    );
    const invoice = await generate(schoolId, "2027-10-01", "2027-11-01");
    await updateInvoice(invoice.id, { status: "issued" }, ACTOR);

    await expect(cancelInvoice(invoice.id, ACTOR)).rejects.toThrow(
      /brouillon/i,
    );
  });
});

describe("listInvoices", () => {
  it("filtre par statut", async () => {
    const schoolId = await makeSchool();
    await makeConfirmedSession(
      schoolId,
      "Cours",
      "2027-11-03T09:00:00.000Z",
      "2027-11-03T12:00:00.000Z",
    );
    const invoice = await generate(schoolId, "2027-11-01", "2027-12-01");

    const drafts = await listInvoices({ page: 1, pageSize: 100, status: "draft" });
    expect(drafts.data.some((i) => i.id === invoice.id)).toBe(true);

    const paid = await listInvoices({ page: 1, pageSize: 100, status: "paid" });
    expect(paid.data.some((i) => i.id === invoice.id)).toBe(false);
  });
});
