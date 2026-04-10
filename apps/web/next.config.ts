import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for the prod Dockerfile (infra/Dockerfile).
  output: "standalone",
  // Instance A's `@budget-tracker/db` package ships its exports map pointing
  // directly at `.ts` source (no build step), so Next needs to transpile it
  // alongside the app. Add any other workspace-internal TS packages here as
  // they come online.
  transpilePackages: ["@budget-tracker/db"],
};

export default nextConfig;
