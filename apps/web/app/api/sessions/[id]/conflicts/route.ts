import { withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/api/auth";
import { ok } from "@/lib/api/response";
import { idParamSchema } from "@/lib/validators/common";
import { detectConflicts } from "@/lib/services/sessions";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApi<RouteContext>(async (_req, ctx) => {
  requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  const conflicts = await detectConflicts(id);
  return ok(conflicts);
});
