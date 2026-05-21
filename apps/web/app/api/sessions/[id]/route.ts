import type { NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/api/auth";
import { noContent, ok } from "@/lib/api/response";
import { idParamSchema } from "@/lib/validators/common";
import { sessionUpdateSchema } from "@/lib/validators/sessions";
import {
  cancelSession,
  getSession,
  updateSession,
} from "@/lib/services/sessions";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApi<RouteContext>(async (_req, ctx) => {
  requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  const session = await getSession(id);
  return ok(session);
});

export const PATCH = withApi<RouteContext>(async (req: NextRequest, ctx) => {
  const actor = requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  const input = sessionUpdateSchema.parse(await req.json());
  const session = await updateSession(id, input, actor.email);
  return ok(session);
});

export const DELETE = withApi<RouteContext>(async (_req, ctx) => {
  const actor = requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  await cancelSession(id, actor.email);
  return noContent();
});
