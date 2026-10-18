import { countryFromCloudflare, analyticsMode } from "@/lib/analytics-policy";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const country = countryFromCloudflare(request.headers);
  return Response.json({ country, mode: analyticsMode(country) }, {
    headers: { "Cache-Control": "private, no-store, max-age=0", "CDN-Cache-Control": "no-store" },
  });
}
