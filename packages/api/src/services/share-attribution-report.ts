import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";

type SharingAccount = {
  publicId: string;
  sharingAccountId: string;
  displayName: string | null;
  handle: string | null;
};

type AttributionCounts = {
  opens: number;
  signups: number;
  agentReady: number;
  seasonEntries: number;
};

export async function getShareAttributionReport(db: DrizzleDB, owner: string | undefined, page: number) {
  const limit = 50;
  const links = sql`
    WITH links AS (
      SELECT l.code, l.path, l.analytics_id, u.id AS owner_id, u.public_id, u.display_name, u.handle,
        a.analytics_id AS sharing_account_id
      FROM house_share_links l
      JOIN users u ON u.id = l.owner_id
      JOIN house_share_accounts a ON a.user_id = l.owner_id
      WHERE u.deleted_at IS NULL ${owner ? sql`AND u.public_id = ${owner}` : sql``}
    ), opens AS (
      SELECT o.link_code, count(*)::int AS opens
      FROM house_share_opens o JOIN links l ON l.code = o.link_code
      GROUP BY o.link_code
    ), outcomes AS (
      SELECT o.link_code, count(*)::int AS signups,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM campaign_conversion_events c
          WHERE c.user_id = s.user_id AND c.event_name = 'agent_ready' AND c.share_open_id = s.share_open_id
        ))::int AS agent_ready,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM campaign_conversion_events c
          WHERE c.user_id = s.user_id AND c.event_name = 'season_entry' AND c.share_open_id = s.share_open_id
        ))::int AS season_entries
      FROM campaign_conversion_events s
      JOIN house_share_opens o ON o.id = s.share_open_id
      JOIN links l ON l.code = o.link_code
      WHERE s.event_name = 'signup_completed'
      GROUP BY o.link_code
    ), totals AS (
      SELECT l.*, coalesce(o.opens, 0) AS opens, coalesce(c.signups, 0) AS signups,
        coalesce(c.agent_ready, 0) AS agent_ready, coalesce(c.season_entries, 0) AS season_entries
      FROM links l
      LEFT JOIN opens o ON o.link_code = l.code
      LEFT JOIN outcomes c ON c.link_code = l.code
    )`;
  const offset = (page - 1) * limit;
  if (owner) {
    const [account] = await db.execute<SharingAccount>(sql`
      SELECT u.public_id AS "publicId", u.display_name AS "displayName", u.handle, a.analytics_id AS "sharingAccountId"
      FROM users u JOIN house_share_accounts a ON a.user_id = u.id
      WHERE public_id = ${owner} AND deleted_at IS NULL`);
    const rows = await db.execute<AttributionCounts & { code: string; path: string; shareLinkId: string }>(sql`
      ${links}
      SELECT code, path, analytics_id AS "shareLinkId", opens, signups, agent_ready AS "agentReady", season_entries AS "seasonEntries"
      FROM totals ORDER BY signups DESC, opens DESC, code LIMIT ${limit + 1} OFFSET ${offset}`);
    return { level: "link" as const, account: account ?? null, rows: rows.slice(0, limit), hasNext: rows.length > limit };
  }
  const rows = await db.execute<SharingAccount & AttributionCounts & { links: number }>(sql`
    ${links}
    SELECT public_id AS "publicId", sharing_account_id AS "sharingAccountId", display_name AS "displayName", handle, count(*)::int AS links,
      sum(opens)::int AS opens, sum(signups)::int AS signups,
      sum(agent_ready)::int AS "agentReady", sum(season_entries)::int AS "seasonEntries"
    FROM totals GROUP BY owner_id, public_id, sharing_account_id, display_name, handle
    ORDER BY signups DESC, opens DESC, public_id LIMIT ${limit + 1} OFFSET ${offset}`);
  return { level: "account" as const, rows: rows.slice(0, limit), hasNext: rows.length > limit };
}
