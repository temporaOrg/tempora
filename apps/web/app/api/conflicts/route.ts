import type { NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/api/auth";
import { paginated } from "@/lib/api/response";
import { conflictListQuerySchema } from "@/lib/validators/conflicts";
import { listConflicts } from "@/lib/services/conflicts";

export const GET = withApi(async (req: NextRequest) => {
  requireAuth();
  const query = conflictListQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  const { data, pagination } = await listConflicts(query);
  return paginated(data, pagination);
});
