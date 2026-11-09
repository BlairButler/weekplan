import type { CalEvent, Occ } from "./types";
import { addDays, atMinutes, dayIndex, minutesOfDay, startOfDay } from "./time";

/** Expand one-off and recurring events into concrete occurrences overlapping [from, to). */
export function expand(events: CalEvent[], from: number, to: number): Occ[] {
  const out: Occ[] = [];
  for (const ev of events) {
    if (!ev.recurrence) {
      if (ev.end > from && ev.start < to) {
        out.push({ ...ev, occId: ev.id, baseId: ev.id, origStart: ev.start, recurring: false });
      }
      continue;
    }
    const duration = ev.end - ev.start;
    const tod = minutesOfDay(ev.start);
    const firstDay = startOfDay(ev.start);
    const exdates = new Set(ev.exdates);
    // begin a day early so occurrences crossing midnight into `from` are included
    let day = Math.max(addDays(startOfDay(from), -1), firstDay);
    for (; day < to; day = addDays(day, 1)) {
      if (!ev.recurrence.days.includes(dayIndex(day))) continue;
      const start = atMinutes(day, tod);
      const end = start + duration;
      const until = ev.recurrence.until;
      if (until !== null && start > until) break;
      if (exdates.has(start) || end <= from || start >= to) continue;
      out.push({ ...ev, start, end, occId: `${ev.id}@${start}`, baseId: ev.id, origStart: start, recurring: true });
    }
  }
  return out;
}
