import type { NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/api/auth";
import { noContent, ok } from "@/lib/api/response";
import { idParamSchema } from "@/lib/validators/common";
import { invoiceUpdateSchema } from "@/lib/validators/invoices";
import { cancelInvoice, getInvoice, updateInvoice } from "@/lib/services/invoices";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApi<RouteContext>(async (_req, ctx) => {
  requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  const invoice = await getInvoice(id);
  return ok(invoice);
});

export const PATCH = withApi<RouteContext>(async (req: NextRequest, ctx) => {
  const actor = requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  const input = invoiceUpdateSchema.parse(await req.json());
  const invoice = await updateInvoice(id, input, actor.email);
  return ok(invoice);
});

export const DELETE = withApi<RouteContext>(async (_req, ctx) => {
  const actor = requireAuth();
  const { id } = idParamSchema.parse(await ctx.params);
  await cancelInvoice(id, actor.email);
  return noContent();
});
