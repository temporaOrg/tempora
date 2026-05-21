import type { NextRequest } from "next/server";
import { withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/api/auth";
import { created, paginated } from "@/lib/api/response";
import {
  sessionCreateSchema,
  sessionListQuerySchema,
} from "@/lib/validators/sessions";
import { createSession, listSessions } from "@/lib/services/sessions";

export const GET = withApi(async (req: NextRequest) => {
  requireAuth();
  const query = sessionListQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  const { data, pagination } = await listSessions(query);
  return paginated(data, pagination);
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = requireAuth();
  const input = sessionCreateSchema.parse(await req.json());
  const session = await createSession(input, actor.email);
  return created(session);
});
