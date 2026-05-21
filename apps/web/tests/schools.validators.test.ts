import { describe, expect, it } from "vitest";
import {
  schoolCreateSchema,
  schoolListQuerySchema,
  schoolUpdateSchema,
} from "@/lib/validators/schools";

describe("schoolCreateSchema", () => {
  it("accepte une école minimale (nom seul)", () => {
    const result = schoolCreateSchema.parse({ name: "Sup de Vinci" });
    expect(result.name).toBe("Sup de Vinci");
  });

  it("trim le nom et rejette un nom vide", () => {
    expect(() => schoolCreateSchema.parse({ name: "   " })).toThrow();
  });

  it("rejette un SIRET non numérique ou de mauvaise longueur", () => {
    expect(() =>
      schoolCreateSchema.parse({ name: "X", siret: "123" }),
    ).toThrow();
    const ok = schoolCreateSchema.parse({ name: "X", siret: "12345678901234" });
    expect(ok.siret).toBe("12345678901234");
  });

  it("rejette un taux horaire négatif", () => {
    expect(() =>
      schoolCreateSchema.parse({ name: "X", defaultHourlyRate: -1 }),
    ).toThrow();
  });

  it("rejette un email de facturation invalide", () => {
    expect(() =>
      schoolCreateSchema.parse({ name: "X", billingEmail: "pasunemail" }),
    ).toThrow();
  });

  it("rejette une couleur hors format hexadécimal", () => {
    expect(() =>
      schoolCreateSchema.parse({ name: "X", color: "rouge" }),
    ).toThrow();
    const ok = schoolCreateSchema.parse({ name: "X", color: "#1a2b3c" });
    expect(ok.color).toBe("#1a2b3c");
  });
});

describe("schoolUpdateSchema", () => {
  it("exige au moins un champ", () => {
    expect(() => schoolUpdateSchema.parse({})).toThrow();
  });

  it("autorise une mise à jour partielle", () => {
    const result = schoolUpdateSchema.parse({ city: "Paris" });
    expect(result.city).toBe("Paris");
  });
});

describe("schoolListQuerySchema", () => {
  it("applique les valeurs par défaut de pagination", () => {
    const result = schoolListQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.includeArchived).toBe(false);
  });

  it("coerce les nombres et le flag includeArchived depuis la query-string", () => {
    const result = schoolListQuerySchema.parse({
      page: "2",
      pageSize: "5",
      includeArchived: "true",
    });
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(5);
    expect(result.includeArchived).toBe(true);
  });

  it("plafonne pageSize", () => {
    expect(() => schoolListQuerySchema.parse({ pageSize: "999" })).toThrow();
  });
});
