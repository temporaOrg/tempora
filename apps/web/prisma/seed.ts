import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

// tsx ne charge pas .env automatiquement ; on le fait avant d'instancier le client.
config({ path: ".env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL n'est pas défini.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  // Idempotent : on repart propre à chaque seed de dev.
  await prisma.conflictSession.deleteMany();
  await prisma.conflict.deleteMany();
  await prisma.invoiceLine.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.session.deleteMany();
  await prisma.ingestion.deleteMany();
  await prisma.school.deleteMany();

  const supdevinci = await prisma.school.create({
    data: {
      name: "Sup de Vinci",
      city: "Paris",
      country: "FR",
      defaultHourlyRate: "60.00",
      color: "#1d76db",
    },
  });

  const epitech = await prisma.school.create({
    data: {
      name: "Epitech",
      city: "Lyon",
      country: "FR",
      defaultHourlyRate: "55.00",
      color: "#e99695",
    },
  });

  await prisma.session.createMany({
    data: [
      {
        schoolId: supdevinci.id,
        title: "Architecture logicielle",
        classe: "B3 DEV",
        startAt: new Date("2026-06-01T09:00:00Z"),
        endAt: new Date("2026-06-01T12:00:00Z"),
        hourlyRate: "60.00",
        status: "confirmed",
        source: "manual",
      },
      {
        schoolId: epitech.id,
        title: "Bases de données",
        classe: "MSc1",
        // Chevauche volontairement la session précédente -> conflit de démo.
        startAt: new Date("2026-06-01T10:00:00Z"),
        endAt: new Date("2026-06-01T13:00:00Z"),
        hourlyRate: "55.00",
        status: "proposal",
        source: "ical",
      },
    ],
  });

  console.log("Seed terminé : 2 écoles, 2 sessions (dont 1 chevauchement).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
