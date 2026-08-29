import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  redirects() {
    return [
      {
        "source": "/.well-known/farcaster.json",
        "destination": "https://api.farcaster.xyz/miniapps/hosted-manifest/01a04c08-27ae-dfc0-8377-9082f82a2536",
        "permanent": false
      }
    ]
  },
};

export default nextConfig;
