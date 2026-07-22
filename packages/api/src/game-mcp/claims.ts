/**
 * Games MCP claims adapter.
 *
 * Ownership resolution lives in protocol-neutral match-access-context.
 * This module remains a thin Games MCP-facing re-export so existing callers
 * (cognitive artifacts, production read-model) keep stable import paths.
 */

import type { DrizzleDB } from "../db/index.js";
import {
  resolveSubjectGameAccessClaims,
  type SubjectGameAccessClaims,
} from "../services/match-access-context.js";

export type { SubjectGameAccessClaims as GamesMcpClaims } from "../services/match-access-context.js";

export async function resolveGamesMcpClaims(
  db: DrizzleDB,
  userId: string,
): Promise<SubjectGameAccessClaims> {
  return resolveSubjectGameAccessClaims(db, userId);
}
