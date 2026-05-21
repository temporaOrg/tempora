import type { NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/api/auth";
import { ok } from "@/lib/api/response";
import { idParamSchema } from "@/lib/validators/common";
import { conflictResolveSchema } from "@/lib/validators/conflicts";
import { getConflict, resolveConflict } from "@/lib/services/conflicts";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApi<RouteContext>(async (_req, ctx) => {
  requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  const conflict = await getConflict(id);
  return ok(conflict);
});

export const PATCH = withApi<RouteContext>(async (req: NextRequest, ctx) => {
  const actor = requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  const input = conflictResolveSchema.parse(await req.json());
  const conflict = await resolveConflict(id, input, actor.email);
  return ok(conflict);
});
