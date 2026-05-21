import { describe, expect, it } from "vitest";
import {
  conflictListQuerySchema,
  conflictResolveSchema,
} from "@/lib/validators/conflicts";

describe("conflictResolveSchema", () => {
  it("accepte resolved avec une note", () => {
    const result = conflictResolveSchema.parse({
      status: "resolved",
      resolutionNote: "Session reprogrammée.",
    });
    expect(result.status).toBe("resolved");
    expect(result.resolutionNote).toBe("Session reprogrammée.");
  });

  it("accepte ignored sans note", () => {
    const result = conflictResolveSchema.parse({ status: "ignored" });
    expect(result.status).toBe("ignored");
  });

  it("rejette le statut open (réservé à la détection)", () => {
    expect(() => conflictResolveSchema.parse({ status: "open" })).toThrow();
  });

  it("exige un statut", () => {
    expect(() => conflictResolveSchema.parse({})).toThrow();
  });
});

describe("conflictListQuerySchema", () => {
  it("applique la pagination par défaut", () => {
    const result = conflictListQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.status).toBeUndefined();
  });

  it("accepte un filtre de statut valide", () => {
    const result = conflictListQuerySchema.parse({ status: "open" });
    expect(result.status).toBe("open");
  });

  it("rejette un statut hors enum", () => {
    expect(() =>
      conflictListQuerySchema.parse({ status: "pending" }),
    ).toThrow();
  });
});
