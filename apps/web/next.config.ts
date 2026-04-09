import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for the prod Dockerfile (infra/Dockerfile).
  output: "standalone",
};

export default nextConfig;
