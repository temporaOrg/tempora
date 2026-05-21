import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Les tests d'intégration partagent une seule base Postgres de dev. Exécutés
    // en parallèle, leurs écritures/nettoyages concurrents se télescopent (une
    // suite lit ou supprime pendant qu'une autre écrit) → faux négatifs non
    // déterministes. La suite tourne en < 2 s en séquentiel : on désactive le
    // parallélisme inter-fichiers plutôt que de cloisonner chaque test dans sa
    // propre base.
    fileParallelism: false,
  },
});
