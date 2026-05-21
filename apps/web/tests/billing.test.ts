import { describe, it, expect } from "vitest";
import { Prisma } from "../lib/generated/prisma/client";
import { computeBillableAmount } from "../lib/billing";

const rate = (n: string | number) => new Prisma.Decimal(n);

describe("computeBillableAmount", () => {
  it("calcule durée × taux pour une session de 3h à 50€/h", () => {
    const start = new Date("2026-06-01T09:00:00Z");
    const end = new Date("2026-06-01T12:00:00Z");
    expect(computeBillableAmount(start, end, rate(50)).toString()).toBe("150");
  });

  it("gère les demi-heures (1h30 à 80€/h = 120€)", () => {
    const start = new Date("2026-06-01T09:00:00Z");
    const end = new Date("2026-06-01T10:30:00Z");
    expect(computeBillableAmount(start, end, rate(80)).toString()).toBe("120");
  });

  it("arrondit au centime", () => {
    const start = new Date("2026-06-01T09:00:00Z");
    const end = new Date("2026-06-01T09:20:00Z"); // 1/3 h
    expect(computeBillableAmount(start, end, rate(50)).toString()).toBe("16.67");
  });

  it("rejette une fin antérieure au début", () => {
    const start = new Date("2026-06-01T12:00:00Z");
    const end = new Date("2026-06-01T09:00:00Z");
    expect(() => computeBillableAmount(start, end, rate(50))).toThrow();
  });

  it("rejette un taux négatif", () => {
    const start = new Date("2026-06-01T09:00:00Z");
    const end = new Date("2026-06-01T10:00:00Z");
    expect(() => computeBillableAmount(start, end, rate(-10))).toThrow();
  });
});
