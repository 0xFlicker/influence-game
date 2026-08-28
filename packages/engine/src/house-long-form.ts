import type {
  HouseGameplaySummaryContext,
  HouseGameplaySummaryResult,
  HouseCoveredWindow,
} from "./game-runner.types";
import { isBoundedHouseAuthoredText } from "./house-summary-frontier";
import type { StructuredDomainDecodeResult } from "./structured-output";

export const HOUSE_LONG_FORM_SUMMARY_MAX_CHARACTERS = 6_000;

/** Exact routing contract for House-authored producer copy. It carries no factual proof fields. */
export const HOUSE_LONG_FORM_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      minLength: 1,
      maxLength: HOUSE_LONG_FORM_SUMMARY_MAX_CHARACTERS,
    },
    thinking: { type: ["string", "null"], maxLength: 2_000 },
  },
  required: ["summary", "thinking"],
  additionalProperties: false,
};

function record(
  value: unknown,
  label: string,
): StructuredDomainDecodeResult<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { status: "valid", value: value as Record<string, unknown> }
    : { status: "invalid", message: `${label} must be an object.` };
}

function sameWindow(left: HouseCoveredWindow, right: HouseCoveredWindow): boolean {
  return left.fromRound === right.fromRound
    && left.toRound === right.toRound
    && left.fromPhase === right.fromPhase
    && left.toPhase === right.toPhase;
}

export function decodeHouseLongFormProvider(
  value: unknown,
  context: HouseGameplaySummaryContext,
): StructuredDomainDecodeResult<HouseGameplaySummaryResult> {
  const decoded = record(value, "House long-form summary");
  if (decoded.status === "invalid") return decoded;
  if (Object.keys(decoded.value).some((key) => key !== "summary" && key !== "thinking")) {
    return { status: "invalid", message: "House long-form summary contains unsupported fields." };
  }
  if (!isBoundedHouseAuthoredText(decoded.value.summary, HOUSE_LONG_FORM_SUMMARY_MAX_CHARACTERS)) {
    return { status: "invalid", message: "House long-form summary must be non-empty authored prose without control characters." };
  }
  if (decoded.value.thinking !== null
      && decoded.value.thinking !== undefined
      && !isBoundedHouseAuthoredText(decoded.value.thinking, 2_000)) {
    return { status: "invalid", message: "House long-form thinking is malformed." };
  }
  return {
    status: "valid",
    value: {
      summary: decoded.value.summary,
      kind: context.kind,
      coveredWindow: { ...context.coveredWindow },
      ...(typeof decoded.value.thinking === "string" && { thinking: decoded.value.thinking }),
    },
  };
}

export function decodeAcceptedHouseLongForm(
  value: unknown,
  context: HouseGameplaySummaryContext,
): StructuredDomainDecodeResult<HouseGameplaySummaryResult> {
  const decoded = record(value, "Accepted House long-form summary");
  if (decoded.status === "invalid") return decoded;
  const keys = new Set(Object.keys(decoded.value));
  if ([...keys].some((key) => !["summary", "kind", "coveredWindow", "thinking"].includes(key))) {
    return { status: "invalid", message: "Accepted House long-form summary contains unsupported fields." };
  }
  if (decoded.value.kind !== context.kind
      || !decoded.value.coveredWindow
      || typeof decoded.value.coveredWindow !== "object"
      || Array.isArray(decoded.value.coveredWindow)
      || !sameWindow(decoded.value.coveredWindow as HouseCoveredWindow, context.coveredWindow)) {
    return { status: "invalid", message: "Accepted House long-form boundary does not match the current context." };
  }
  return decodeHouseLongFormProvider({
    summary: decoded.value.summary,
    thinking: decoded.value.thinking ?? null,
  }, context);
}
