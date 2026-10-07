import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg is a server-only driver; keep it out of the bundler.
  serverExternalPackages: ["pg"],
  turbopack: {
    resolveAlias: {
      // See lib/pica-lite.js — lets Excalidraw resize images under fingerprinting protection.
      pica: "./lib/pica-lite.js",
    },
  },
};

export default nextConfig;
