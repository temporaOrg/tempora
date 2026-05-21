import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "@/lib/api/openapi";
import "@/lib/validators/schools";
import "@/lib/validators/sessions";
import "@/lib/validators/conflicts";

describe("buildOpenApiDocument", () => {
  it("génère un document OpenAPI 3.0.3 valide", () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe("3.0.3");
    expect(doc.info.title).toBe("Tempora API");
  });

  it("expose les routes de la ressource schools", () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.["/schools"]).toBeDefined();
    expect(doc.paths?.["/schools"]?.get).toBeDefined();
    expect(doc.paths?.["/schools"]?.post).toBeDefined();
    expect(doc.paths?.["/schools/{id}"]?.patch).toBeDefined();
    expect(doc.paths?.["/schools/{id}"]?.delete).toBeDefined();
  });

  it("référence le schéma School dans les composants", () => {
    const doc = buildOpenApiDocument();
    expect(doc.components?.schemas?.["School"]).toBeDefined();
  });

  it("expose les routes de la ressource sessions", () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.["/sessions"]?.get).toBeDefined();
    expect(doc.paths?.["/sessions"]?.post).toBeDefined();
    expect(doc.paths?.["/sessions/{id}"]?.patch).toBeDefined();
    expect(doc.paths?.["/sessions/{id}"]?.delete).toBeDefined();
    expect(doc.paths?.["/sessions/{id}/conflicts"]?.get).toBeDefined();
  });

  it("référence le schéma Session dans les composants", () => {
    const doc = buildOpenApiDocument();
    expect(doc.components?.schemas?.["Session"]).toBeDefined();
  });

  it("expose les routes de la ressource conflicts", () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.["/conflicts"]?.get).toBeDefined();
    expect(doc.paths?.["/conflicts/detect"]?.post).toBeDefined();
    expect(doc.paths?.["/conflicts/{id}"]?.get).toBeDefined();
    expect(doc.paths?.["/conflicts/{id}"]?.patch).toBeDefined();
  });

  it("référence le schéma Conflict dans les composants", () => {
    const doc = buildOpenApiDocument();
    expect(doc.components?.schemas?.["Conflict"]).toBeDefined();
  });
});
