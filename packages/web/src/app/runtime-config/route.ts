import { NextResponse } from "next/server";

// Force dynamic so process.env is read at request time, not cached at build time
export const dynamic = "force-dynamic";

/**
 * Runtime config Route Handler.
 *
 * Returns environment-specific config as JSON. Because this runs on the
 * server at request time (not at build time), `process.env.PRIVY_APP_ID`
 * etc. are read from the actual runtime environment — they are NOT inlined
 * by webpack.
 *
 * For local dev compat we fall back to `NEXT_PUBLIC_*` vars (which ARE
 * inlined at build time and work fine in dev).
 */
export function GET() {
  const config = {
    PRIVY_APP_ID:
      process.env.PRIVY_APP_ID ??
      process.env.NEXT_PUBLIC_PRIVY_APP_ID ??
      "",
    API_URL:
      process.env.API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:3000",
    WS_URL:
      process.env.WS_URL ??
      process.env.NEXT_PUBLIC_WS_URL ??
      "ws://localhost:3000",
    ADMIN_ADDRESS:
      process.env.ADMIN_ADDRESS ??
      process.env.NEXT_PUBLIC_ADMIN_ADDRESS ??
      "",
    EPHEMERAL: process.env.EPHEMERAL === "true",
    EPHEMERAL_PR: process.env.EPHEMERAL_PR ?? "",
    SOURCE_ENV_URL: process.env.SOURCE_ENV_URL ?? "",
  };

  return NextResponse.json(config, {
    headers: {
      // Allow short-lived caching — config rarely changes within a deploy
      "Cache-Control": "public, max-age=60, s-maxage=300",
    },
  });
}
