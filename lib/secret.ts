import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets kept in Postgres (the AI agent's API key), keyed by
 * the SECRET_KEY env var. Without it values stay plain text, as before; a plain
 * value saved earlier still reads and gets sealed on its next save.
 */
const PREFIX = "enc:";
const key = () => (process.env.SECRET_KEY ? createHash("sha256").update(process.env.SECRET_KEY).digest() : null);

export function seal(plain: string) {
  const k = key();
  if (!k || !plain) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** "" when the value was sealed under a SECRET_KEY that is now missing or different — the admin re-enters it. */
export function unseal(stored: string) {
  if (!stored.startsWith(PREFIX)) return stored;
  const k = key();
  if (!k) return "";
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
