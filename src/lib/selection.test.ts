import { describe, expect, it } from "vitest";
import { editOccs } from "./store";
import { expand } from "./recurrence";
import { defaultEvents } from "./defaults";
import { addDays, atMinutes, MIN } from "./time";
import type { CalEvent } from "./types";

const WEEK = new Date(2026, 10, 9).getTime();
const DAY = 24 * 60 * MIN;

function ev(id: string, day: number, h: number, mins: number): CalEvent {
  const start = atMinutes(addDays(WEEK, day), h * 60);
  return { id, title: id, categoryId: "chores", start, end: start + mins * MIN, mode: "task", source: "task", recurrence: null, exdates: [], notify: "default", notes: "", createdAt: 1, updatedAt: 1, taskId: "t" };
}

describe("multi-select edits", () => {
  const events = [...defaultEvents(WEEK), ev("a", 0, 19, 15), ev("b", 0, 19.25, 15), ev("c", 0, 19.5, 30)];
  const occs = expand(events, WEEK, addDays(WEEK, 7));

  it("moves a group by the same delta (Mon evening → Sun)", () => {
    const sel = occs.filter((o) => ["a", "b", "c"].includes(o.id));
    const { events: next, ids } = editOccs(events, sel, (e) => ({ ...e, start: e.start + 6 * DAY, end: e.end + 6 * DAY }));
    const moved = next.filter((e) => ["a", "b", "c"].includes(e.id));
    expect(moved.map((e) => e.start)).toEqual([atMinutes(addDays(WEEK, 6), 19 * 60), atMinutes(addDays(WEEK, 6), 19 * 60 + 15), atMinutes(addDays(WEEK, 6), 19 * 60 + 30)]);
    expect(ids.sort()).toEqual(["a", "b", "c"]);
    expect(next.length).toBe(events.length);
  });

  it("detaches a selected recurring occurrence, leaving the rest of the series", () => {
    const sleepMon = occs.find((o) => o.baseId === "sleep-weeknights" && new Date(o.start).getDate() === 9)!;
    const one = occs.find((o) => o.id === "a")!;
    const { events: next, ids } = editOccs(events, [sleepMon, one], (e) => ({ ...e, start: e.start + 60 * MIN, end: e.end + 60 * MIN }));
    const series = next.find((e) => e.id === "sleep-weeknights")!;
    expect(series.exdates).toContain(sleepMon.origStart);
    const detached = next.find((e) => ids.includes(e.id) && e.title === "Sleep")!;
    expect(detached.recurrence).toBeNull();
    expect(detached.start).toBe(sleepMon.start + 60 * MIN);
    expect(next.length).toBe(events.length + 1);
  });

  it("deletes a group in one go", () => {
    const sel = occs.filter((o) => ["a", "b"].includes(o.id));
    const { events: next } = editOccs(events, sel, () => null);
    expect(next.map((e) => e.id)).not.toContain("a");
    expect(next.length).toBe(events.length - 2);
  });
});
