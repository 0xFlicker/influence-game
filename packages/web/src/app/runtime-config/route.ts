import { NextResponse } from "next/server";
import { getPublicRuntimeConfig } from "@/lib/server-runtime-config";

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
  return NextResponse.json(getPublicRuntimeConfig(), {
    headers: {
      // Allow short-lived caching — config rarely changes within a deploy
      "Cache-Control": "public, max-age=60, s-maxage=300",
    },
  });
}
