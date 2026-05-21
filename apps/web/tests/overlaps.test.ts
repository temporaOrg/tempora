import { describe, it, expect } from "vitest";
import { overlaps } from "../lib/conflicts";

const range = (s: string, e: string) => ({
  startAt: new Date(s),
  endAt: new Date(e),
});

describe("overlaps", () => {
  it("détecte deux créneaux qui se chevauchent", () => {
    const a = range("2026-06-01T09:00:00Z", "2026-06-01T11:00:00Z");
    const b = range("2026-06-01T10:00:00Z", "2026-06-01T12:00:00Z");
    expect(overlaps(a, b)).toBe(true);
  });

  it("ne détecte pas de chevauchement pour des créneaux contigus", () => {
    const a = range("2026-06-01T09:00:00Z", "2026-06-01T10:00:00Z");
    const b = range("2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z");
    expect(overlaps(a, b)).toBe(false); // borne sup exclue
  });

  it("est symétrique", () => {
    const a = range("2026-06-01T09:00:00Z", "2026-06-01T11:00:00Z");
    const b = range("2026-06-01T10:00:00Z", "2026-06-01T12:00:00Z");
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });

  it("détecte un créneau entièrement inclus dans un autre", () => {
    const a = range("2026-06-01T09:00:00Z", "2026-06-01T18:00:00Z");
    const b = range("2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z");
    expect(overlaps(a, b)).toBe(true);
  });
});
