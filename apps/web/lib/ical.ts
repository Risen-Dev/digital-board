// Pure iCalendar (RFC 5545) writer for the project feed; no imports so `board.check.ts` can load it.

export type IcalTask = { id: string; key: string; title: string; description: string | null; dueDate: string; column: string };

const escape = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets continue on the next line after one space. */
function fold(line: string) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += n;
  }
  return [...out, cur].join("\r\n ");
}

const date = (d: string) => d.replaceAll("-", "");
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** One all-day event per task, on its due date. */
export function toIcal(name: string, tasks: IcalTask[], now = new Date()) {
  const dtstamp = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//digital-board//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escape(name)}`,
    ...tasks.flatMap((t) => [
      "BEGIN:VEVENT",
      `UID:${t.id}@digital-board`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${date(t.dueDate)}`,
      `DTEND;VALUE=DATE:${date(nextDay(t.dueDate))}`,
      `SUMMARY:${escape(`${t.key} ${t.title}`)}`,
      `DESCRIPTION:${escape([`Column: ${t.column}`, t.description].filter(Boolean).join("\n\n"))}`,
      `CATEGORIES:${escape(t.column)}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
