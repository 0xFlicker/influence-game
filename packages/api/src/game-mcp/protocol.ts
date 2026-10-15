/**
 * Single source of truth for the MCP protocol versions The House MCP
 * server supports. The initialize handler negotiates from this list and
 * the Streamable HTTP transport validates the MCP-Protocol-Version
 * header against it, so the two can never drift apart.
 *
 * Versions are listed newest first; the first entry is the version the
 * server offers when a client proposes one it does not support.
 */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;

export type McpSupportedProtocolVersion =
  (typeof MCP_SUPPORTED_PROTOCOL_VERSIONS)[number];

export const MCP_LATEST_PROTOCOL_VERSION: McpSupportedProtocolVersion =
  MCP_SUPPORTED_PROTOCOL_VERSIONS[0];

const SUPPORTED_SET: ReadonlySet<string> = new Set(
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
);

export function isSupportedMcpProtocolVersion(
  value: string,
): value is McpSupportedProtocolVersion {
  return SUPPORTED_SET.has(value);
}

/** JSON-RPC Invalid Params error raised for malformed initialize input. */
export class McpInvalidParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpInvalidParamsError";
  }
}

function supportedVersionsSentence(): string {
  return `Supported protocol versions are: ${MCP_SUPPORTED_PROTOCOL_VERSIONS.join(", ")}.`;
}

/**
 * A well-formed protocol version is a real calendar date in
 * YYYY-MM-DD form (the MCP versioning scheme). Anything else — free
 * text, numbers, impossible dates — is malformed, not merely unknown.
 */
export function isWellFormedProtocolVersion(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Negotiate the protocol version for an initialize request, per the MCP
 * lifecycle: echo the client's version when supported, otherwise offer
 * our latest supported version and let the client decide whether to
 * proceed. An unknown but well-formed version (including one newer
 * than anything we know) is a normal negotiation outcome, never an
 * error. Only a missing or malformed version is an error.
 */
export function negotiateMcpProtocolVersion(params: unknown): string {
  const proposed =
    params !== null && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>).protocolVersion
      : undefined;
  if (proposed === undefined) {
    throw new McpInvalidParamsError(
      `initialize requires params.protocolVersion. ${supportedVersionsSentence()}`,
    );
  }
  if (!isWellFormedProtocolVersion(proposed)) {
    throw new McpInvalidParamsError(
      `Invalid protocolVersion ${JSON.stringify(proposed)}: expected a version date in YYYY-MM-DD form. ${supportedVersionsSentence()}`,
    );
  }
  return isSupportedMcpProtocolVersion(proposed)
    ? proposed
    : MCP_LATEST_PROTOCOL_VERSION;
}

/** Message for rejecting an unsupported MCP-Protocol-Version header. */
export function unsupportedProtocolVersionMessage(version: string): string {
  return `Unsupported MCP protocol version "${version}". ${supportedVersionsSentence()}`;
}
