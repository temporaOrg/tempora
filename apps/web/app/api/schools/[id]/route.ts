import type { NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/api/auth";
import { noContent, ok } from "@/lib/api/response";
import { idParamSchema } from "@/lib/validators/common";
import { schoolUpdateSchema } from "@/lib/validators/schools";
import {
  archiveSchool,
  getSchool,
  updateSchool,
} from "@/lib/services/schools";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApi<RouteContext>(async (_req, ctx) => {
  requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  const school = await getSchool(id);
  return ok(school);
});

export const PATCH = withApi<RouteContext>(async (req: NextRequest, ctx) => {
  const actor = requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  const input = schoolUpdateSchema.parse(await req.json());
  const school = await updateSchool(id, input, actor.email);
  return ok(school);
});

export const DELETE = withApi<RouteContext>(async (_req, ctx) => {
  const actor = requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  await archiveSchool(id, actor.email);
  return noContent();
});
