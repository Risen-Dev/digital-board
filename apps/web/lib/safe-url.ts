import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";

/**
 * Admin-typed URLs (outgoing webhook, AI base URL) are fetched by the server, so
 * they must not reach loopback, the LAN, or cloud metadata (SSRF). Self-hosters
 * who point them at a local Ollama or n8n set ALLOW_PRIVATE_URLS=1.
 */
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, bits, "ipv6");

/** Why the server must not fetch `raw`, or null when it may. */
// ponytail: checked before each fetch, not pinned to the socket, so DNS rebinding between the two still slips through; pin with a custom undici dispatcher if that matters.
export async function urlProblem(raw: string): Promise<string | null> {
  if (!URL.canParse(raw)) return "Not a valid URL.";
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") return "URL must start with http:// or https://.";
  if (process.env.ALLOW_PRIVATE_URLS === "1") return null;
  const addrs = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true }).catch(() => []);
  if (!addrs.length) return "Could not resolve that host.";
  if (addrs.some((a) => blocked.check(a.address, a.family === 6 ? "ipv6" : "ipv4"))) {
    return "URL points to a private or local address. Set ALLOW_PRIVATE_URLS=1 on the server to allow it.";
  }
  return null;
}
