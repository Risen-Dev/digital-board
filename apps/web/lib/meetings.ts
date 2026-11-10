// Meetings: shared types and the pure schedule maths. Safe on client and server.

export const MEETING_REPEATS = ["none", "daily", "weekdays", "weekly", "monthly"] as const;
export type MeetingRepeat = (typeof MEETING_REPEATS)[number];
export const REPEAT_LABEL: Record<MeetingRepeat, string> = {
  none: "Once", daily: "Every day", weekdays: "Every weekday", weekly: "Every week", monthly: "Every month",
};

export type Meeting = {
  id: string;
  title: string;
  notes: string | null;
  link: string | null;
  /** YYYY-MM-DD and HH:MM, wall-clock in the viewer's own time zone. */
  startDate: string;
  startTime: string;
  durationMin: number;
  repeat: MeetingRepeat;
  remindMin: number;
  attendeeIds: string[];
  createdBy: string | null;
};

const MAX_STEPS = 5000;

/** The k-th occurrence's local start, or null past the end of a one-off. Monthly keeps the day, clamped (Jan 31 → Feb 28). */
function occurrence(m: Pick<Meeting, "startDate" | "startTime" | "repeat">, k: number): Date | null {
  const [y, mo, d] = m.startDate.split("-").map(Number);
  const [h, mi] = m.startTime.split(":").map(Number);
  if (m.repeat === "none") return k === 0 ? new Date(y, mo - 1, d, h, mi) : null;
  if (m.repeat === "monthly") {
    const last = new Date(y, mo - 1 + k + 1, 0).getDate();
    return new Date(y, mo - 1 + k, Math.min(d, last), h, mi);
  }
  return new Date(y, mo - 1, d + k * (m.repeat === "weekly" ? 7 : 1), h, mi);
}

/**
 * The occurrence that is on now or comes next: its start and end. Null when a one-off
 * has ended. Weekdays skip Saturday and Sunday (including a weekend start date).
 */
export function nextOccurrence(m: Pick<Meeting, "startDate" | "startTime" | "repeat" | "durationMin">, now: Date) {
  // ponytail: walks occurrences from the start date (≤5000 steps, ~14 years daily); jump ahead if meetings ever get older.
  for (let k = 0; k < MAX_STEPS; k++) {
    const start = occurrence(m, k);
    if (!start) return null;
    if (m.repeat === "weekdays" && (start.getDay() === 0 || start.getDay() === 6)) continue;
    const end = new Date(start.getTime() + m.durationMin * 60_000);
    if (end > now) return { start, end };
  }
  return null;
}

export type MeetingState = "later" | "soon" | "live";

/** "soon" inside the reminder window, "live" while it runs. */
export function meetingState(m: Meeting, now: Date) {
  const next = nextOccurrence(m, now);
  if (!next) return null;
  const state: MeetingState = now >= next.start ? "live" : next.start.getTime() - now.getTime() <= m.remindMin * 60_000 ? "soon" : "later";
  return { ...next, state };
}

/** Only http(s) links are kept: the link is rendered as an href. */
export const safeLink = (raw: string) => {
  const s = raw.trim();
  try {
    return s && /^https?:$/.test(new URL(s).protocol) ? s : null;
  } catch {
    return null;
  }
};
