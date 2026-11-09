import { describe, expect, it } from "vitest";
import { applyPlan, planEmptyTime, planWithMoves } from "./scheduler";
import { defaultCategories, defaultEvents, defaultSettings, newTask } from "./defaults";
import { expand } from "./recurrence";
import { weekTotals } from "./targets";
import { addDays, atMinutes, dayIndex, MIN } from "./time";
import type { CalEvent, Category, Task } from "./types";

const WEEK = new Date(2026, 10, 9).getTime(); // Monday 9 Nov 2026
const H = 60 * MIN;
const settings = defaultSettings();

function ev(id: string, categoryId: string, day: number, startH: number, hours: number, mode: CalEvent["mode"] = "fixed", createdAt = 1): CalEvent {
  const start = atMinutes(addDays(WEEK, day), startH * 60);
  return { id, title: id, categoryId, start, end: start + hours * H, mode, source: "manual", recurrence: null, exdates: [], notify: "default", notes: "", createdAt, updatedAt: createdAt };
}

function onlyResearch(target = 30): Category[] {
  return defaultCategories().map((c) => ({ ...c, targetHours: c.id === "research" ? target : null }));
}

function totalsFor(events: CalEvent[], now: number) {
  return weekTotals(expand(events, WEEK, addDays(WEEK, 7)), WEEK, now);
}

describe("recurrence", () => {
  it("expands sleep into 7 nights inside the week", () => {
    const occs = expand(defaultEvents(WEEK), WEEK, addDays(WEEK, 7));
    // Sun-before 22:00 crosses into Monday; plus Mon–Thu, Sat 00:00, Sun 00:00, Sun 22:00
    expect(occs.length).toBe(8);
    const sat = occs.find((o) => dayIndex(o.start) === 5)!;
    expect(new Date(sat.start).getHours()).toBe(0);
    expect((sat.end - sat.start) / H).toBe(8);
  });
});

describe("targets", () => {
  it("never counts overlapping time twice", () => {
    const events = [ev("a", "research", 0, 9, 2, "fixed", 1), ev("b", "research", 0, 10, 2, "fixed", 2)];
    expect(totalsFor(events, WEEK).get("research")!.scheduled).toBe(180);
  });

  it("gives the slot to the most recently placed event", () => {
    const events = [ev("train", "transport", 0, 9, 1.5, "fixed", 1), ev("trek", "leisure", 0, 9.5, 0.75, "fixed", 2)];
    const t = totalsFor(events, WEEK);
    expect(t.get("transport")!.scheduled).toBe(45);
    expect(t.get("leisure")!.scheduled).toBe(45);
  });
});

describe("scheduler: empty-time fill", () => {
  it("fills a research target around sleep and fixed events", () => {
    const events = [...defaultEvents(WEEK), ev("lecture", "lectures", 0, 9, 2)];
    const plan = planEmptyTime(events, onlyResearch(), settings, WEEK, WEEK - 1);
    const after = applyPlan(events, plan, WEEK);
    expect(totalsFor(after, WEEK).get("research")!.scheduled).toBe(30 * 60);
    expect(plan.unplaceable).toEqual({});
    const occs = expand(after, WEEK, addDays(WEEK, 7));
    const lecture = occs.find((o) => o.id === "lecture")!;
    for (const a of plan.add) {
      // no overlap with lecture incl. 15 min buffer, and inside 8am–6pm
      expect(a.end + 15 * MIN <= lecture.start || a.start >= lecture.end + 15 * MIN).toBe(true);
      expect(new Date(a.start).getHours()).toBeGreaterThanOrEqual(8);
      expect(a.end).toBeLessThanOrEqual(atMinutes(new Date(a.start).setHours(0, 0, 0, 0), 18 * 60));
    }
  });

  it("re-places the hours lost when a Tuesday block is cut short", () => {
    // Week already planned: 30h research. User cuts Tuesday 4h block to 2h at Tue 12:00.
    const cats = onlyResearch();
    let events = [...defaultEvents(WEEK)];
    events = applyPlan(events, planEmptyTime(events, cats, settings, WEEK, WEEK - 1), WEEK);
    const tue = expand(events, WEEK, addDays(WEEK, 7)).find((o) => o.categoryId === "research" && dayIndex(o.start) === 1)!;
    const now = tue.start + 2 * H;
    events = events.map((e) => (e.id === tue.id ? { ...e, end: tue.start + 2 * H } : e));
    const lost = (tue.end - tue.start) / MIN - 120;
    const plan = planEmptyTime(events, cats, settings, WEEK, now);
    const added = plan.add.reduce((s, a) => s + (a.end - a.start) / MIN, 0);
    expect(added).toBe(lost);
    for (const a of plan.add) expect(a.start).toBeGreaterThanOrEqual(now);
  });

  it("spreads 4 x 2h gym sessions over different days", () => {
    const cats = defaultCategories().map((c) => ({ ...c, targetHours: c.id === "gym" ? 8 : null }));
    const plan = planEmptyTime(defaultEvents(WEEK), cats, settings, WEEK, WEEK - 1);
    expect(plan.add.length).toBe(4);
    expect(new Set(plan.add.map((a) => dayIndex(a.start))).size).toBe(4);
    for (const a of plan.add) expect(a.end - a.start).toBe(2 * H);
  });

  it("removes surplus future target-fill when a block is extended", () => {
    const cats = onlyResearch(10);
    let events = [...defaultEvents(WEEK)];
    events = applyPlan(events, planEmptyTime(events, cats, settings, WEEK, WEEK - 1), WEEK);
    events.push(ev("extra", "research", 4, 19, 3, "fixed", 5));
    const plan = planEmptyTime(events, cats, settings, WEEK, WEEK - 1);
    const after = applyPlan(events, plan, WEEK);
    expect(totalsFor(after, WEEK).get("research")!.scheduled).toBe(10 * 60);
  });

  it("reports what cannot fit", () => {
    const plan = planEmptyTime(defaultEvents(WEEK), onlyResearch(100), settings, WEEK, WEEK - 1);
    expect(plan.unplaceable.research).toBeGreaterThan(0);
  });

  it("does nothing for a week that is already over", () => {
    const plan = planEmptyTime(defaultEvents(WEEK), onlyResearch(), settings, WEEK, addDays(WEEK, 8));
    expect(plan.add.length).toBe(0);
  });
});

describe("scheduler: moves preview", () => {
  it("moves a flexible block out of the way when empty time runs out", () => {
    const cats = defaultCategories().map((c) => ({
      ...c,
      targetHours: c.id === "research" ? 4 : null,
      rules: c.id === "research" ? { ...c.rules, windows: [{ days: [0], start: 9 * 60, end: 13 * 60 }], buffer: 0 } : c.rules,
    }));
    // A flexible climbing session sits in Monday's only research window.
    const events = [ev("climb", "climbing", 0, 9, 2, "flexible")];
    const empty = planEmptyTime(events, cats, settings, WEEK, WEEK - 1);
    expect(empty.unplaceable.research).toBe(120);
    const moved = planWithMoves(events, cats, settings, WEEK, WEEK - 1)!;
    expect(moved).not.toBeNull();
    expect(moved.unplaceable).toEqual({});
    expect(moved.moves.climb).toBeDefined();
  });
});

describe("tasks", () => {
  const noTargets = () => defaultCategories().map((c) => ({ ...c, targetHours: null }));
  const task = (over: Partial<Task> = {}): Task => ({ ...newTask(), title: "Clean toilet", ...over });

  it("places a weekly chore at home, within home hours, not during uni or travel", () => {
    // Monday: commute 7:00–8:30, lecture 9–11, commute back 15:00–16:30 → away 7:00–16:30
    const events = [...defaultEvents(WEEK), ev("c1", "transport", 0, 7, 1.5), ev("lec", "lectures", 0, 9, 2), ev("c2", "transport", 0, 15, 1.5)];
    const s = { ...settings, homeHours: { start: 7 * 60, end: 21 * 60 + 30 } };
    const plan = planEmptyTime(events, noTargets(), s, WEEK, WEEK - 1, [task()]);
    expect(plan.add.length).toBe(1);
    const a = plan.add[0];
    expect(a.end - a.start).toBe(15 * MIN);
    expect(a.taskId).toBeDefined();
    // Monday is the first day; earliest home time is after 16:30 (not 11–15 between uni events)
    expect(dayIndex(a.start)).toBe(0);
    expect(a.start).toBeGreaterThanOrEqual(atMinutes(WEEK, 16 * 60 + 30));
  });

  it("spreads N-per-week tasks over different days", () => {
    const plan = planEmptyTime(defaultEvents(WEEK), noTargets(), settings, WEEK, WEEK - 1, [task({ title: "Star Trek", duration: 45, repeat: { kind: "weekly", times: 3 } })]);
    expect(plan.add.length).toBe(3);
    expect(new Set(plan.add.map((a) => dayIndex(a.start))).size).toBe(3);
  });

  it("can put a travel-friendly task inside a commute", () => {
    // Fill every home slot so only the commute is left.
    const cats = noTargets();
    const busy = [0, 1, 2, 3, 4, 5, 6].map((d) => ev(`busy${d}`, "teaching", d, 6, 16));
    const events = [...defaultEvents(WEEK), ...busy, ev("train", "transport", 2, 22, 1.5)];
    const s = { ...settings, homeHours: { start: 0, end: 24 * 60 } };
    const trek = task({ title: "Star Trek", categoryId: "leisure", duration: 45, travelOk: true, where: "anywhere" });
    const plan = planEmptyTime(events.filter((e) => !e.id.startsWith("sleep")), cats, s, WEEK, WEEK - 1, [trek]);
    // with sleep removed, any time 22:00–06:00 is free too; restrict to the commute by blocking nights
    expect(plan.add.length).toBe(1);
    const withSleep = planEmptyTime(events, cats, s, WEEK, WEEK - 1, [trek]);
    expect(withSleep.add.length).toBe(1);
    const t = withSleep.add[0];
    expect(t.start).toBeGreaterThanOrEqual(atMinutes(addDays(WEEK, 2), 22 * 60));
    expect(t.end).toBeLessThanOrEqual(atMinutes(addDays(WEEK, 2), 23 * 60 + 30));
  });

  it("prefers a commute over home time for travel-friendly tasks", () => {
    const events = [...defaultEvents(WEEK), ev("train", "transport", 0, 17, 1.5)];
    const trek = task({ title: "Star Trek", categoryId: "leisure", duration: 45, travelOk: true });
    const plan = planEmptyTime(events, noTargets(), settings, WEEK, WEEK - 1, [trek]);
    expect(plan.add[0].start).toBe(atMinutes(WEEK, 17 * 60));
  });

  it("moves a missed task to the next gap, but leaves a ticked one alone", () => {
    const t = task();
    const missed = { ...ev("m", "chores", 0, 17, 0.25, "task"), taskId: t.id, done: false };
    const now = atMinutes(WEEK, 19 * 60); // 1h45 after it ended
    const plan = planEmptyTime([...defaultEvents(WEEK), missed], noTargets(), settings, WEEK, now, [t]);
    expect(plan.remove).toContain("m");
    expect(plan.add.length).toBe(1);
    expect(plan.add[0].start).toBeGreaterThanOrEqual(now);

    const ticked = { ...missed, done: true };
    const plan2 = planEmptyTime([...defaultEvents(WEEK), ticked], noTargets(), settings, WEEK, now, [t]);
    expect(plan2.remove.length + plan2.add.length).toBe(0);
  });

  it("doesn't re-add a completed one-off task", () => {
    const t = task({ repeat: { kind: "once", due: null }, completedAt: WEEK });
    expect(planEmptyTime(defaultEvents(WEEK), noTargets(), settings, WEEK, WEEK - 1, [t]).add.length).toBe(0);
  });

  it("gives targets priority: lifts task blocks when a target can't otherwise fit", () => {
    const cats = defaultCategories().map((c) => ({
      ...c,
      targetHours: c.id === "research" ? 2 : null,
      rules: c.id === "research" ? { ...c.rules, windows: [{ days: [0], start: 9 * 60, end: 11 * 60 }], buffer: 0 } : c.rules,
    }));
    const t = task({ where: "anywhere", duration: 30 });
    const blocking = { ...ev("tb", "chores", 0, 10, 0.5, "task"), taskId: t.id, done: false };
    const plan = planEmptyTime([...defaultEvents(WEEK), blocking], cats, settings, WEEK, WEEK - 1, [t]);
    expect(plan.unplaceable).toEqual({});
    expect(plan.remove).toContain("tb");
    expect(plan.add.filter((a) => a.taskId).length).toBe(1);
  });
});
