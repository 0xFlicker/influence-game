import { and, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

export interface EvidenceAccessor {
  userId?: string;
  roles?: readonly string[];
  permissions?: readonly string[];
}

export interface EvidenceManifestReadRequest {
  manifestId: string;
  gameId?: string;
  accessor: EvidenceAccessor;
  purpose: string;
}

export interface ActiveEvidenceManifest {
  id: string;
  gameId: string;
  ownerEpoch: string;
  eventSequence?: number;
  evidenceType: string;
  retentionClass: string;
  accessScope: string;
  redactionStatus: string;
  expiresAt?: string;
  storageProvider?: string;
  storageBucket?: string;
  storageKey?: string;
  sourcePointers?: ReadonlyArray<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RedactedEvidenceManifest {
  gameId: string;
  eventSequence?: number;
  evidenceType: string;
  retentionClass: string;
  accessScope: string;
  redactionStatus: string;
  expiresAt?: string;
  redactedAt?: string;
  createdAt: string;
}

export type EvidenceManifestReadResult =
  | { ok: true; manifest: ActiveEvidenceManifest }
  | { ok: false; status: "not_found" | "denied"; error: string }
  | { ok: false; status: "expired" | "redacted"; manifest: RedactedEvidenceManifest };

function hasPrivateEvidenceAccess(accessor: EvidenceAccessor): boolean {
  const permissions = new Set(accessor.permissions ?? []);
  const roles = new Set(accessor.roles ?? []);
  return permissions.has("view_admin") ||
    permissions.has("manage_roles") ||
    roles.has("sysop") ||
    roles.has("producer");
}

function unavailableStatus(row: {
  redactionStatus: string;
  expiresAt: string | null;
}): "expired" | "redacted" | null {
  if (row.redactionStatus !== "active") return "redacted";
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return "expired";
  return null;
}

async function auditEvidenceManifestRead(
  db: DrizzleDB,
  params: {
    manifestId: string;
    gameId: string;
    accessor: EvidenceAccessor;
    purpose: string;
    outcome: string;
  },
): Promise<void> {
  await db.insert(schema.gameEvidenceManifestReads)
    .values({
      manifestId: params.manifestId,
      gameId: params.gameId,
      accessorUserId: params.accessor.userId,
      accessorRole: params.accessor.roles?.[0],
      purpose: params.purpose,
      outcome: params.outcome,
    });
}

export async function readEvidenceManifest(
  db: DrizzleDB,
  request: EvidenceManifestReadRequest,
): Promise<EvidenceManifestReadResult> {
  const conditions = request.gameId
    ? and(
        eq(schema.gameEvidenceManifests.id, request.manifestId),
        eq(schema.gameEvidenceManifests.gameId, request.gameId),
      )
    : eq(schema.gameEvidenceManifests.id, request.manifestId);

  const row = (await db
    .select()
    .from(schema.gameEvidenceManifests)
    .where(conditions))[0];

  if (!row) {
    return { ok: false, status: "not_found", error: "Evidence manifest not found" };
  }

  if (!hasPrivateEvidenceAccess(request.accessor)) {
    await auditEvidenceManifestRead(db, {
      manifestId: row.id,
      gameId: row.gameId,
      accessor: request.accessor,
      purpose: request.purpose,
      outcome: "denied",
    });
    return { ok: false, status: "denied", error: "Insufficient evidence permissions" };
  }

  const status = unavailableStatus(row);
  if (status) {
    await auditEvidenceManifestRead(db, {
      manifestId: row.id,
      gameId: row.gameId,
      accessor: request.accessor,
      purpose: request.purpose,
      outcome: status,
    });
    return {
      ok: false,
      status,
      manifest: {
        gameId: row.gameId,
        eventSequence: row.eventSequence ?? undefined,
        evidenceType: row.evidenceType,
        retentionClass: row.retentionClass,
        accessScope: row.accessScope,
        redactionStatus: row.redactionStatus,
        expiresAt: row.expiresAt ?? undefined,
        redactedAt: row.redactedAt ?? undefined,
        createdAt: row.createdAt,
      },
    };
  }

  await auditEvidenceManifestRead(db, {
    manifestId: row.id,
    gameId: row.gameId,
    accessor: request.accessor,
    purpose: request.purpose,
    outcome: "allowed",
  });

  return {
    ok: true,
    manifest: {
      id: row.id,
      gameId: row.gameId,
      ownerEpoch: row.ownerEpoch,
      eventSequence: row.eventSequence ?? undefined,
      evidenceType: row.evidenceType,
      retentionClass: row.retentionClass,
      accessScope: row.accessScope,
      redactionStatus: row.redactionStatus,
      expiresAt: row.expiresAt ?? undefined,
      storageProvider: row.storageProvider ?? undefined,
      storageBucket: row.storageBucket ?? undefined,
      storageKey: row.storageKey ?? undefined,
      sourcePointers: row.sourcePointers ?? undefined,
      metadata: row.metadata,
      createdAt: row.createdAt,
    },
  };
}
