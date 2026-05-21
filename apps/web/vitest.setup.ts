import { config } from "dotenv";

// Charge DATABASE_URL pour les tests d'intégration (Prisma + Postgres).
config({ path: ".env" });
