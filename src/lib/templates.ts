import type { CalEvent, Occ, TemplateItem, WeekTemplate } from "./types";
import { addDays, atMinutes, dayIndex, MIN, minutesOfDay, uid } from "./time";

/**
 * Events worth saving into a template: things you placed yourself.
 * Recurring events (e.g. Sleep) already repeat, and target-fill / task blocks are regenerated.
 */
export function templateCandidates(occs: Occ[], weekStart: number): Occ[] {
  const weekEnd = addDays(weekStart, 7);
  return occs
    .filter((o) => !o.ghost && !o.recurring && !o.taskId && o.mode !== "target-fill" && o.mode !== "task")
    .filter((o) => o.start >= weekStart && o.start < weekEnd)
    .sort((a, b) => a.start - b.start);
}

export function toTemplateItems(occs: Occ[]): TemplateItem[] {
  return occs.map((o) => ({
    title: o.title,
    categoryId: o.categoryId,
    day: dayIndex(o.start),
    start: minutesOfDay(o.start),
    duration: Math.round((o.end - o.start) / MIN),
    mode: o.mode === "flexible" ? "flexible" : "fixed",
    notify: o.notify,
    notes: o.notes,
  }));
}

/** Stamp a template into the week starting `weekStart`, replacing earlier copies of the same template in that week. */
export function applyTemplate(events: CalEvent[], tpl: WeekTemplate, weekStart: number, now: number): CalEvent[] {
  const weekEnd = addDays(weekStart, 7);
  const kept = events.filter((e) => !(e.templateId === tpl.id && e.start >= weekStart && e.start < weekEnd));
  const stamped: CalEvent[] = tpl.items.map((it, i) => {
    const start = atMinutes(addDays(weekStart, it.day), it.start);
    return {
      id: uid(),
      title: it.title,
      categoryId: it.categoryId,
      start,
      end: start + it.duration * MIN,
      mode: it.mode,
      source: "template",
      recurrence: null,
      exdates: [],
      notify: it.notify,
      notes: it.notes,
      createdAt: now + i,
      updatedAt: now + i,
      templateId: tpl.id,
    };
  });
  return [...kept, ...stamped];
}

export function templateAppliedIn(events: CalEvent[], tplId: string, weekStart: number): boolean {
  const weekEnd = addDays(weekStart, 7);
  return events.some((e) => e.templateId === tplId && e.start >= weekStart && e.start < weekEnd);
}
