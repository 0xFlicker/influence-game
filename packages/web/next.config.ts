import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the authenticated browser harness from taking the local dev server's lock.
  distDir: process.env.NEXT_PUBLIC_E2E_AUTH === "true" ? ".next/e2e" : ".next",
  // Transpile Privy + wagmi packages as needed
  transpilePackages: [],
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

export default nextConfig;
