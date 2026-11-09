import { describe, expect, it } from "vitest";
import { applyTemplate, templateAppliedIn, templateCandidates, toTemplateItems } from "./templates";
import { defaultEvents } from "./defaults";
import { expand } from "./recurrence";
import { addDays, atMinutes, MIN } from "./time";
import type { CalEvent, WeekTemplate } from "./types";

const WEEK = new Date(2026, 10, 9).getTime(); // Monday
const NEXT = addDays(WEEK, 7);

function ev(id: string, categoryId: string, day: number, startH: number, hours: number, extra: Partial<CalEvent> = {}): CalEvent {
  const start = atMinutes(addDays(WEEK, day), startH * 60);
  return { id, title: id, categoryId, start, end: start + hours * 60 * MIN, mode: "fixed", source: "manual", recurrence: null, exdates: [], notify: "default", notes: "", createdAt: 1, updatedAt: 1, ...extra };
}

describe("week templates", () => {
  const events = [
    ...defaultEvents(WEEK),
    ev("lecture", "lectures", 0, 9, 2),
    ev("rovers", "rovers", 6, 19, 3, { mode: "flexible" }),
    ev("auto", "research", 1, 8, 4, { mode: "target-fill", source: "target-fill" }),
    ev("chore", "chores", 1, 20, 0.25, { mode: "task", taskId: "t1" }),
    ev("lastweek", "teaching", -2, 10, 1),
  ];

  it("captures only hand-placed events from that week", () => {
    const occs = expand(events, WEEK, NEXT);
    const picked = templateCandidates(occs, WEEK).map((o) => o.id);
    expect(picked).toEqual(["lecture", "rovers"]);
    const items = toTemplateItems(templateCandidates(occs, WEEK));
    expect(items[0]).toMatchObject({ day: 0, start: 9 * 60, duration: 120, mode: "fixed" });
    expect(items[1]).toMatchObject({ day: 6, start: 19 * 60, duration: 180, mode: "flexible" });
  });

  it("stamps into another week at the same weekday/time, and re-applying replaces", () => {
    const tpl: WeekTemplate = { id: "sem", name: "Semester", items: toTemplateItems(templateCandidates(expand(events, WEEK, NEXT), WEEK)), order: 0, createdAt: 0 };
    let next = applyTemplate(events, tpl, NEXT, 100);
    const stamped = next.filter((e) => e.templateId === "sem");
    expect(stamped.length).toBe(2);
    expect(stamped[0].start).toBe(atMinutes(NEXT, 9 * 60));
    expect(stamped[1].start).toBe(atMinutes(addDays(NEXT, 6), 19 * 60));
    expect(templateAppliedIn(next, "sem", NEXT)).toBe(true);
    expect(templateAppliedIn(next, "sem", WEEK)).toBe(false);

    next = applyTemplate(next, tpl, NEXT, 200);
    expect(next.filter((e) => e.templateId === "sem").length).toBe(2);
    expect(next.length).toBe(events.length + 2);
  });
});
