/** Runs once per server start: the hourly tick for the daily "cards due" push. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { pushDueCards } = await import("./lib/push");
  const tick = () => void pushDueCards().catch((err) => console.error("due push failed", err));
  setTimeout(tick, 60_000);
  setInterval(tick, 60 * 60_000);
}
