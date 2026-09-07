import type {
  AnyFormatResolutionPayload,
  CanonicalGameEvent,
  FormatResolutionAggregate,
  FormatResolutionPayloadV1,
  FormatResolutionPayloadV2,
} from "../canonical-events";

export type FormatResolvedEvent = Extract<
  CanonicalGameEvent,
  { type: "format.resolved" }
>;

function cloneAggregate(aggregate: FormatResolutionAggregate): FormatResolutionAggregate {
  if (aggregate.capability === "sealed_elim") {
    return {
      capability: "sealed_elim",
      totals: { ...aggregate.totals },
      eligiblePlayerIds: [...aggregate.eligiblePlayerIds],
    };
  }
  if (aggregate.capability === "sealed_polarity") {
    return {
      capability: "sealed_polarity",
      nets: { ...aggregate.nets },
      savesReceived: { ...aggregate.savesReceived },
      eliminateReceived: { ...aggregate.eliminateReceived },
    };
  }
  if (aggregate.capability === "two_names") {
    return {
      capability: "two_names",
      initialNomineeIds: [...aggregate.initialNomineeIds],
      overrideHolderId: aggregate.overrideHolderId,
      overrideAction: aggregate.overrideAction,
      removedNomineeId: aggregate.removedNomineeId,
      replacementNomineeId: aggregate.replacementNomineeId,
      finalistPlayerIds: [...aggregate.finalistPlayerIds],
      eligibleVoterIds: [...aggregate.eligibleVoterIds],
      totals: { ...aggregate.totals },
    };
  }
  return {
    capability: "public_chain",
    starterId: aggregate.starterId,
    safePlayerIds: [...aggregate.safePlayerIds],
    vulnerablePlayerIds: [...aggregate.vulnerablePlayerIds],
    voteTotals: { ...aggregate.voteTotals },
  };
}

function aggregateFromV1(
  payload: FormatResolutionPayloadV1,
  sequence: number,
): FormatResolutionAggregate {
  if (payload.formatId === "save_or_eliminate" && payload.saveOrEliminate) {
    return {
      capability: "sealed_polarity",
      nets: { ...payload.saveOrEliminate.nets },
      savesReceived: { ...payload.saveOrEliminate.savesReceived },
      eliminateReceived: { ...payload.saveOrEliminate.eliminateReceived },
    };
  }
  if (payload.formatId === "vote_bomb" && payload.voteBomb) {
    const zeroSafe = new Set(payload.voteBomb.zeroSafePlayerIds);
    return {
      capability: "sealed_elim",
      totals: { ...payload.voteBomb.totals },
      eligiblePlayerIds: Object.keys(payload.voteBomb.totals).filter(
        (id) => !zeroSafe.has(id),
      ),
    };
  }
  if (payload.formatId === "safety_bounce" && payload.safetyBounce) {
    return {
      capability: "public_chain",
      starterId: payload.safetyBounce.starterId,
      safePlayerIds: [...payload.safetyBounce.safePlayerIds],
      vulnerablePlayerIds: [...payload.safetyBounce.vulnerablePlayerIds],
      voteTotals: { ...payload.safetyBounce.voteTotals },
    };
  }
  throw new Error(
    `Malformed format.resolved v1 aggregate for ${payload.formatId} at sequence ${sequence}`,
  );
}

/**
 * Read either historical v1 bags or the v2 capability aggregate. Historical
 * events are normalized once here; callers never infer game facts from prose.
 */
export function formatResolutionAggregate(
  event: FormatResolvedEvent,
): FormatResolutionAggregate {
  const payloadVersion: number = event.payloadVersion;
  if (payloadVersion === 2) {
    const payload = event.payload as FormatResolutionPayloadV2;
    return cloneAggregate(payload.aggregate);
  }
  if (payloadVersion !== 1) {
    throw new Error(
      `Unsupported format.resolved payload version ${String(payloadVersion)} at sequence ${event.sequence}`,
    );
  }

  return aggregateFromV1(event.payload as FormatResolutionPayloadV1, event.sequence);
}

/** Normalize an internal resolution write request to the version-2 payload. */
export function toFormatResolutionPayloadV2(
  payload: AnyFormatResolutionPayload,
): FormatResolutionPayloadV2 {
  if (payload.aggregate) {
    return {
      formatId: payload.formatId,
      empoweredId: payload.empoweredId,
      eliminatedId: payload.eliminatedId,
      resolutionKind: payload.resolutionKind,
      tiedPlayerIds: [...payload.tiedPlayerIds],
      tiebreakerId: payload.tiebreakerId,
      aggregate: cloneAggregate(payload.aggregate),
    };
  }

  return {
    formatId: payload.formatId,
    empoweredId: payload.empoweredId,
    eliminatedId: payload.eliminatedId,
    resolutionKind: payload.resolutionKind,
    tiedPlayerIds: [...payload.tiedPlayerIds],
    tiebreakerId: payload.tiebreakerId,
    aggregate: aggregateFromV1(payload as FormatResolutionPayloadV1, 0),
  };
}
