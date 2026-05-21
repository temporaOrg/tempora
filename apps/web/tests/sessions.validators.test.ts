import { describe, expect, it } from "vitest";
import {
  sessionCreateSchema,
  sessionListQuerySchema,
  sessionUpdateSchema,
} from "@/lib/validators/sessions";

const VALID = {
  schoolId: "school_1",
  title: "Cours React",
  startAt: "2026-06-01T09:00:00.000Z",
  endAt: "2026-06-01T12:00:00.000Z",
};

describe("sessionCreateSchema", () => {
  it("accepte une session minimale et coerce les dates", () => {
    const result = sessionCreateSchema.parse(VALID);
    expect(result.startAt).toBeInstanceOf(Date);
    expect(result.endAt).toBeInstanceOf(Date);
    expect(result.title).toBe("Cours React");
  });

  it("rejette une fin antérieure ou égale au début", () => {
    expect(() =>
      sessionCreateSchema.parse({
        ...VALID,
        endAt: "2026-06-01T09:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejette un titre vide", () => {
    expect(() =>
      sessionCreateSchema.parse({ ...VALID, title: "   " }),
    ).toThrow();
  });

  it("rejette un taux horaire négatif", () => {
    expect(() =>
      sessionCreateSchema.parse({ ...VALID, hourlyRate: -10 }),
    ).toThrow();
  });

  it("rejette le statut invoiced en entrée (réservé à la facturation)", () => {
    expect(() =>
      sessionCreateSchema.parse({ ...VALID, status: "invoiced" }),
    ).toThrow();
  });

  it("exige un schoolId", () => {
    const withoutSchool = {
      title: VALID.title,
      startAt: VALID.startAt,
      endAt: VALID.endAt,
    };
    expect(() => sessionCreateSchema.parse(withoutSchool)).toThrow();
  });
});

describe("sessionUpdateSchema", () => {
  it("exige au moins un champ", () => {
    expect(() => sessionUpdateSchema.parse({})).toThrow();
  });

  it("autorise une mise à jour partielle", () => {
    const result = sessionUpdateSchema.parse({ status: "confirmed" });
    expect(result.status).toBe("confirmed");
  });
});

describe("sessionListQuerySchema", () => {
  it("applique la pagination par défaut", () => {
    const result = sessionListQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("coerce les filtres schoolId/status et les bornes de dates", () => {
    const result = sessionListQuerySchema.parse({
      schoolId: "school_1",
      status: "invoiced",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    });
    expect(result.schoolId).toBe("school_1");
    expect(result.status).toBe("invoiced");
    expect(result.from).toBeInstanceOf(Date);
    expect(result.to).toBeInstanceOf(Date);
  });

  it("rejette un statut hors enum", () => {
    expect(() =>
      sessionListQuerySchema.parse({ status: "draft" }),
    ).toThrow();
  });
});
