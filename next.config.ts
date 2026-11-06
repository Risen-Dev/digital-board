import type { NextConfig } from "next";

/**
 * Baseline headers on every response. Not a full script CSP: Next's inline bootstrap and
 * Excalidraw would need nonces on every page. frame-ancestors stops clickjacking.
 */
// ponytail: no script-src/HSTS; add a nonce CSP via proxy.ts, and HSTS once every deploy is HTTPS-only.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // pg is a server-only driver; keep it out of the bundler.
  serverExternalPackages: ["pg"],
  turbopack: {
    resolveAlias: {
      // See lib/pica-lite.js — lets Excalidraw resize images under fingerprinting protection.
      pica: "./lib/pica-lite.js",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
