import type { NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/api/auth";
import { created, paginated } from "@/lib/api/response";
import {
  invoiceGenerateSchema,
  invoiceListQuerySchema,
} from "@/lib/validators/invoices";
import { generateInvoice, listInvoices } from "@/lib/services/invoices";

export const GET = withApi(async (req: NextRequest) => {
  requireAuth();
  const query = invoiceListQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  const { data, pagination } = await listInvoices(query);
  return paginated(data, pagination);
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = requireAuth();
  const input = invoiceGenerateSchema.parse(await req.json());
  const invoice = await generateInvoice(input, actor.email);
  return created(invoice);
});
