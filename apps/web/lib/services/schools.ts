import { prisma } from "../db";
import { Prisma, type School } from "../generated/prisma/client";
import { NotFoundError } from "../api/errors";
import { recordAudit } from "../audit";
import { buildPaginationMeta } from "../validators/common";
import type { PaginationMeta } from "../api/response";
import type {
  SchoolCreateInput,
  SchoolListQuery,
  SchoolResponse,
  SchoolUpdateInput,
} from "../validators/schools";

/**
 * Logique métier de la ressource `schools`. Les routes ne font qu'appeler ces
 * fonctions ; toute la logique testable (mapping DTO, audit, soft-delete) vit ici.
 */

const ENTITY_TYPE = "school";

/** Mappe une entité Prisma vers la forme JSON exposée (Decimal → string, dates → ISO). */
function toResponse(school: School): SchoolResponse {
  return {
    id: school.id,
    name: school.name,
    siret: school.siret,
    vatNumber: school.vatNumber,
    addressLine: school.addressLine,
    postalCode: school.postalCode,
    city: school.city,
    country: school.country,
    billingEmail: school.billingEmail,
    defaultHourlyRate:
      school.defaultHourlyRate === null
        ? null
        : school.defaultHourlyRate.toFixed(2),
    color: school.color,
    isArchived: school.isArchived,
    createdAt: school.createdAt.toISOString(),
    updatedAt: school.updatedAt.toISOString(),
  };
}

/** Traduit le taux horaire (number) en Prisma.Decimal, en préservant null/undefined. */
function toRate(
  rate: number | null | undefined,
): Prisma.Decimal | null | undefined {
  if (rate === null) return null;
  if (rate === undefined) return undefined;
  return new Prisma.Decimal(rate);
}

export async function createSchool(
  input: SchoolCreateInput,
  actor: string,
): Promise<SchoolResponse> {
  const school = await prisma.school.create({
    data: {
      name: input.name,
      siret: input.siret ?? null,
      vatNumber: input.vatNumber ?? null,
      addressLine: input.addressLine ?? null,
      postalCode: input.postalCode ?? null,
      city: input.city ?? null,
      country: input.country, // undefined → @default("FR")
      billingEmail: input.billingEmail ?? null,
      defaultHourlyRate: toRate(input.defaultHourlyRate),
      color: input.color ?? null,
    },
  });
  const dto = toResponse(school);
  await recordAudit({
    actor,
    action: "create",
    entityType: ENTITY_TYPE,
    entityId: school.id,
    after: dto,
  });
  return dto;
}

export async function listSchools(query: SchoolListQuery): Promise<{
  data: SchoolResponse[];
  pagination: PaginationMeta;
}> {
  const where: Prisma.SchoolWhereInput = {
    ...(query.includeArchived ? {} : { isArchived: false }),
    ...(query.search
      ? { name: { contains: query.search, mode: "insensitive" } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.school.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.school.count({ where }),
  ]);

  return {
    data: rows.map(toResponse),
    pagination: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function getSchool(id: string): Promise<SchoolResponse> {
  const school = await prisma.school.findUnique({ where: { id } });
  if (!school) {
    throw new NotFoundError("École introuvable.");
  }
  return toResponse(school);
}

export async function updateSchool(
  id: string,
  input: SchoolUpdateInput,
  actor: string,
): Promise<SchoolResponse> {
  const existing = await prisma.school.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("École introuvable.");
  }

  const updated = await prisma.school.update({
    where: { id },
    data: {
      name: input.name,
      siret: input.siret,
      vatNumber: input.vatNumber,
      addressLine: input.addressLine,
      postalCode: input.postalCode,
      city: input.city,
      country: input.country,
      billingEmail: input.billingEmail,
      defaultHourlyRate: toRate(input.defaultHourlyRate),
      color: input.color,
    },
  });

  const dto = toResponse(updated);
  await recordAudit({
    actor,
    action: "update",
    entityType: ENTITY_TYPE,
    entityId: id,
    before: toResponse(existing),
    after: dto,
  });
  return dto;
}

/** Soft-delete : on archive plutôt que supprimer (exigence d'audit, spec §2). */
export async function archiveSchool(id: string, actor: string): Promise<void> {
  const existing = await prisma.school.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError("École introuvable.");
  }
  if (existing.isArchived) return; // idempotent

  await prisma.school.update({
    where: { id },
    data: { isArchived: true },
  });
  await recordAudit({
    actor,
    action: "archive",
    entityType: ENTITY_TYPE,
    entityId: id,
    before: toResponse(existing),
  });
}
