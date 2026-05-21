import { describe, expect, it } from "vitest";
import {
  invoiceGenerateSchema,
  invoiceListQuerySchema,
  invoiceUpdateSchema,
} from "@/lib/validators/invoices";

describe("invoiceGenerateSchema", () => {
  it("accepte une école et une période valide", () => {
    const result = invoiceGenerateSchema.parse({
      schoolId: "school-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-07-01",
    });
    expect(result.schoolId).toBe("school-1");
    expect(result.periodStart).toBeInstanceOf(Date);
  });

  it("rejette une fin de période antérieure ou égale au début", () => {
    expect(() =>
      invoiceGenerateSchema.parse({
        schoolId: "school-1",
        periodStart: "2026-07-01",
        periodEnd: "2026-06-01",
      }),
    ).toThrow();
  });

  it("exige une école", () => {
    expect(() =>
      invoiceGenerateSchema.parse({
        periodStart: "2026-06-01",
        periodEnd: "2026-07-01",
      }),
    ).toThrow();
  });
});

describe("invoiceUpdateSchema", () => {
  it("accepte une transition de statut autorisée", () => {
    const result = invoiceUpdateSchema.parse({ status: "issued" });
    expect(result.status).toBe("issued");
  });

  it("accepte une réécriture des références Pennylane", () => {
    const result = invoiceUpdateSchema.parse({
      number: "F-2026-001",
      pennylaneId: "pl_123",
    });
    expect(result.number).toBe("F-2026-001");
    expect(result.pennylaneId).toBe("pl_123");
  });

  it("rejette un retour à draft (transition interdite via PATCH)", () => {
    expect(() => invoiceUpdateSchema.parse({ status: "draft" })).toThrow();
  });

  it("rejette cancelled (l'annulation passe par DELETE)", () => {
    expect(() => invoiceUpdateSchema.parse({ status: "cancelled" })).toThrow();
  });

  it("rejette un corps vide", () => {
    expect(() => invoiceUpdateSchema.parse({})).toThrow();
  });
});

describe("invoiceListQuerySchema", () => {
  it("applique la pagination par défaut", () => {
    const result = invoiceListQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.status).toBeUndefined();
  });

  it("accepte un filtre de statut valide", () => {
    const result = invoiceListQuerySchema.parse({ status: "paid" });
    expect(result.status).toBe("paid");
  });

  it("rejette un statut hors enum", () => {
    expect(() =>
      invoiceListQuerySchema.parse({ status: "refunded" }),
    ).toThrow();
  });
});
