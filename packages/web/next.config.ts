import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile Privy + wagmi packages as needed
  transpilePackages: [],
  // Standalone output for Docker deployments
  output: "standalone",
};

export default nextConfig;
