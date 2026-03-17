import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile Privy + wagmi packages as needed
  transpilePackages: [],
  // Environment variables exposed to the browser
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3000",
  },
};

export default nextConfig;
