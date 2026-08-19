import type { DrizzleDB } from "../db/index.js";
import {
  getGameCostDetail,
  type AdminGameCostDetail,
} from "./provider-cost-accounting.js";
import { getPromptReuseDetail } from "./prompt-reuse-accounting.js";

export type AdminGameCostDetailPayload = AdminGameCostDetail & {
  promptReuse: Awaited<ReturnType<typeof getPromptReuseDetail>>;
};

export type AdminGameCostDetailResult =
  | { ok: true; detail: AdminGameCostDetailPayload }
  | { ok: false; statusCode: 404; error: string };

/** Shared Admin Cost Detail contract for the admin API and producer MCP. */
export async function getAdminGameCostDetail(
  db: DrizzleDB,
  idOrSlug: string,
): Promise<AdminGameCostDetailResult> {
  const result = await getGameCostDetail(db, idOrSlug);
  if (!result.ok) return result;

  return {
    ok: true,
    detail: {
      ...result.detail,
      promptReuse: await getPromptReuseDetail(db, result.detail.gameId),
    },
  };
}
