import type { NextConfig } from "next";
import { withPostHogConfig } from "@posthog/nextjs-config";

const nextConfig: NextConfig = {
  // Keep the authenticated browser harness from taking the local dev server's lock.
  distDir: process.env.NEXT_PUBLIC_E2E_AUTH === "true" ? ".next/e2e" : ".next",
  // Transpile Privy + wagmi packages as needed
  transpilePackages: [],
  outputFileTracingIncludes: { "/rules": ["../../docs/rules-page-content.md", "../../docs/werewolf-rules-page-content.md"] },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.linodeobjects.com",
      },
    ],
  },
  // Standalone output for Docker deployments only
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
  // Proxy /api/* to the API server in dev/test (in production Caddy handles this).
  // Uses API_BACKEND_URL (not NEXT_PUBLIC_API_URL) to avoid self-referencing loops.
  async rewrites() {
    const backendUrl =
      process.env.API_BACKEND_URL ?? "http://127.0.0.1:3000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
    ];
  },
};

// Main release images upload maps for the exact compiled chunks they ship.
// Local/PR builds never need upload credentials or publish source maps.
const uploadSourceMaps = process.env.POSTHOG_UPLOAD_SOURCEMAPS === "1";
if (uploadSourceMaps && !/^[a-f0-9]{40}$/.test(process.env.NEXT_PUBLIC_GIT_SHA ?? "")) {
  throw new Error("PostHog release requires a full NEXT_PUBLIC_GIT_SHA");
}
export default uploadSourceMaps ? withPostHogConfig(nextConfig, {
  personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY ?? "",
  projectId: "671431",
  host: "https://us.posthog.com",
  sourcemaps: {
    enabled: true,
    releaseName: "the-house-web",
    releaseVersion: process.env.NEXT_PUBLIC_GIT_SHA,
    deleteAfterUpload: true,
  },
}) : nextConfig;
