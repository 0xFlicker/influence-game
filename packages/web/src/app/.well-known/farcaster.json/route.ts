import { NextResponse } from "next/server";
import {
  FARCASTER_ACCOUNT_ASSOCIATION,
  FARCASTER_PRODUCTION_ORIGIN,
  buildMiniAppManifest,
} from "@/lib/farcaster-miniapp";

/**
 * Domain-level Mini App manifest. accountAssociation is committed public data
 * in farcaster-miniapp.ts once the operator signs thehouse.game.
 */
export function GET() {
  const body = buildMiniAppManifest({
    baseUrl: FARCASTER_PRODUCTION_ORIGIN,
    accountAssociation: FARCASTER_ACCOUNT_ASSOCIATION,
  });

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
