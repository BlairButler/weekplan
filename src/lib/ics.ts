import type { Category, Occ } from "./types";

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** Plain iCalendar export of concrete occurrences (one VEVENT each). */
export function toICS(occs: Occ[], categories: Category[]): string {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const now = stamp(Date.now());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Weekplan//EN", "CALSCALE:GREGORIAN"];
  for (const o of occs) {
    if (o.ghost) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${o.occId.replace(/[^\w@.-]/g, "")}@weekplan`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(o.start)}`,
      `DTEND:${stamp(o.end)}`,
      `SUMMARY:${esc(o.title)}`,
      `CATEGORIES:${esc(names.get(o.categoryId) ?? "")}`,
      ...(o.notes ? [`DESCRIPTION:${esc(o.notes)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
