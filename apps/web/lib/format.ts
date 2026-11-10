export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Deterministic timestamp formatting, computed on the server and shipped as a
 * string. `toLocale*` must never touch a value that is server-rendered: the
 * server and the browser disagree on locale and timezone, which is a hydration
 * mismatch. Times read in the server's timezone — set `TZ` when self-hosting.
 */
export function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function day(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
