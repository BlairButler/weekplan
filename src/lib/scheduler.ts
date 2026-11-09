import type { CalEvent, Category, Occ, Plan, Settings, Task, TimeWindow } from "./types";
import { addDays, atMinutes, dayIndex, MIN, SNAP, snapDown, snapUp, uid } from "./time";
import { expand } from "./recurrence";
import { dayUsage, weekTotals } from "./targets";

type Interval = [number, number];
const STEP = SNAP * MIN;
const MAX_ITER = 500;

interface Ctx {
  weekStart: number;
  weekEnd: number;
  from: number;
  now: number;
  catById: Map<string, Category>;
  protectedWindows: TimeWindow[];
  homeHours: { start: number; end: number };
  laterTaskIds: Set<string>; // tasks with an open block in a later week
}

/** A task block whose slot ended this long ago without a tick counts as missed and is moved. */
export const MISSED_GRACE = 60 * MIN;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const AWAY: ReadonlySet<string> = new Set(["uni", "gym", "travelling"]);

function subtract(base: Interval[], cuts: Interval[]): Interval[] {
  let result = base;
  for (const [cs, ce] of cuts) {
    const next: Interval[] = [];
    for (const [s, e] of result) {
      if (ce <= s || cs >= e) {
        next.push([s, e]);
        continue;
      }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    result = next;
  }
  return result;
}

function windowIntervals(windows: TimeWindow[], ctx: Ctx): { day: number; iv: Interval }[] {
  const out: { day: number; iv: Interval }[] = [];
  for (let d = 0; d < 7; d++) {
    const dayMs = addDays(ctx.weekStart, d);
    for (const w of windows) {
      if (!w.days.includes(d) || w.end <= w.start) continue;
      out.push({ day: d, iv: [atMinutes(dayMs, w.start), atMinutes(dayMs, w.end)] });
    }
  }
  return out;
}

/** Time that is unavailable for placing blocks of `selfCat`. */
function busyIntervals(occs: Occ[], ctx: Ctx, selfCat: string, buffer: number): Interval[] {
  const pad = buffer * MIN;
  return occs
    .filter((o) => o.categoryId === selfCat || (ctx.catById.get(o.categoryId)?.blocking ?? true))
    .map((o): Interval => [o.start - pad, o.end + pad]);
}

function freeIntervals(cat: Category, occs: Occ[], ctx: Ctx): { day: number; iv: Interval }[] {
  const protectedIvs = windowIntervals(ctx.protectedWindows, ctx).map((x) => x.iv);
  const busy = busyIntervals(occs, ctx, cat.id, cat.rules.buffer);
  const out: { day: number; iv: Interval }[] = [];
  for (const { day, iv } of windowIntervals(cat.rules.windows, ctx)) {
    const clipped: Interval = [Math.max(iv[0], ctx.from), Math.min(iv[1], ctx.weekEnd)];
    if (clipped[1] <= clipped[0]) continue;
    for (const [s, e] of subtract(subtract([clipped], protectedIvs), busy)) {
      const s2 = snapUp(s);
      const e2 = snapDown(e);
      if (e2 > s2) out.push({ day, iv: [s2, e2] });
    }
  }
  return out.sort((a, b) => a.iv[0] - b.iv[0]);
}

function toOcc(ev: CalEvent): Occ {
  return { ...ev, occId: ev.id, baseId: ev.id, origStart: ev.start, recurring: false };
}

export function makeTargetFill(cat: Category, start: number, end: number, now: number): CalEvent {
  return {
    id: uid(),
    title: cat.name,
    categoryId: cat.id,
    start,
    end,
    mode: "target-fill",
    source: "target-fill",
    recurrence: null,
    exdates: [],
    notify: "default",
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
}

/** Places up to `need` minutes of `cat` into free time. Mutates `working` and `added`. Returns minutes left over. */
function placeCategory(cat: Category, need: number, working: Occ[], added: CalEvent[], ctx: Ctx): number {
  const { minBlock, maxBlock, maxPerDay, preference } = cat.rules;
  let left = need;
  for (let i = 0; left > 0 && i < MAX_ITER; i++) {
    const usage = dayUsage(working, cat.id, ctx.weekStart);
    const options = freeIntervals(cat, working, ctx)
      .map((c) => {
        const room = Math.floor(Math.min((c.iv[1] - c.iv[0]) / MIN, maxPerDay - usage[c.day]) / SNAP) * SNAP;
        return { ...c, room };
      })
      .filter((c) => c.room >= minBlock);
    if (!options.length) break;
    const pick =
      preference === "spread"
        ? options.reduce((best, c) => (usage[c.day] < usage[best.day] ? c : best), options[0])
        : options[0];
    const want = Math.max(minBlock, Math.ceil(left / SNAP) * SNAP);
    let len = Math.min(maxBlock, want, pick.room);
    // Don't leave a remainder too small to ever place (it would overshoot the target).
    const rest = left - len;
    if (rest > 0 && rest < minBlock && left - minBlock >= minBlock) len = Math.min(len, left - minBlock);
    const ev = makeTargetFill(cat, pick.iv[0], pick.iv[0] + len * MIN, ctx.now + added.length);
    added.push(ev);
    working.push(toOcc(ev));
    left -= len;
  }
  return Math.max(0, left);
}

/** Removes/shrinks future target-fill blocks when a category is over its target. */
function trimExcess(cat: Category, excess: number, working: Occ[], plan: Plan, ctx: Ctx) {
  const candidates = working
    .filter((o) => o.categoryId === cat.id && o.mode === "target-fill" && !o.recurring && o.start >= ctx.from)
    .sort((a, b) => b.start - a.start);
  for (const o of candidates) {
    if (excess <= 0) break;
    const dur = (o.end - o.start) / MIN;
    if (dur <= excess) {
      plan.remove.push(o.id);
      working.splice(working.indexOf(o), 1);
      excess -= dur;
    } else if (dur - excess >= cat.rules.minBlock) {
      const end = o.end - excess * MIN;
      plan.moves[o.id] = { start: o.start, end };
      o.end = end;
      excess = 0;
    } else break;
  }
}

function makeCtx(categories: Category[], settings: Settings, weekStart: number, now: number, events: CalEvent[] = []): Ctx {
  const weekEnd = addDays(weekStart, 7);
  return {
    weekStart,
    weekEnd,
    from: Math.max(weekStart, snapUp(now)),
    now,
    catById: new Map(categories.map((c) => [c.id, c])),
    protectedWindows: settings.protectedWindows,
    homeHours: settings.homeHours ?? { start: 7 * 60, end: 21 * 60 + 30 },
    laterTaskIds: new Set(events.filter((e) => e.taskId && !e.done && e.start >= weekEnd).map((e) => e.taskId!)),
  };
}

function targetCategories(categories: Category[]): Category[] {
  return categories.filter((c) => (c.targetHours ?? 0) > 0).sort((a, b) => (b.targetHours ?? 0) - (a.targetHours ?? 0));
}

const sumValues = (r: Record<string, number>) => Object.values(r).reduce((x, y) => x + y, 0);

function runTargets(working: Occ[], categories: Category[], ctx: Ctx): Plan {
  const plan: Plan = { add: [], remove: [], moves: {}, unplaceable: {}, taskShort: {} };
  if (ctx.from >= ctx.weekEnd) return plan;
  for (const cat of targetCategories(categories)) {
    const target = (cat.targetHours ?? 0) * 60;
    const have = weekTotals(working, ctx.weekStart, ctx.now).get(cat.id)?.scheduled ?? 0;
    if (have > target) {
      trimExcess(cat, have - target, working, plan, ctx);
      continue;
    }
    const left = placeCategory(cat, target - have, working, plan.add, ctx);
    if (left > 0) plan.unplaceable[cat.id] = left;
  }
  return plan;
}

/** Targets get first claim on time; tasks fill around them. Mutates `working`. */
function planOnOccs(working: Occ[], categories: Category[], ctx: Ctx, tasks: Task[]): Plan {
  const snapshot = working.map((o) => ({ ...o }));
  const plan = runTargets(working, categories, ctx);
  if (tasks.length && sumValues(plan.unplaceable) > 0) {
    // Upcoming task blocks are app-placed, so they may be lifted to make room for targets.
    const lift = new Set(snapshot.filter((o) => o.taskId && !o.done && o.start >= ctx.from).map((o) => o.id));
    if (lift.size) {
      const w2 = snapshot.filter((o) => !lift.has(o.id));
      const plan2 = runTargets(w2, categories, ctx);
      if (sumValues(plan2.unplaceable) < sumValues(plan.unplaceable)) {
        plan2.remove.push(...lift);
        placeTasks(w2, tasks, ctx, plan2);
        working.splice(0, working.length, ...w2);
        return plan2;
      }
    }
  }
  placeTasks(working, tasks, ctx, plan);
  return plan;
}

export function makeTaskEvent(task: Task, start: number, now: number): CalEvent {
  return {
    id: uid(),
    title: task.title,
    categoryId: task.categoryId,
    start,
    end: start + task.duration * MIN,
    mode: "task",
    source: "task",
    recurrence: null,
    exdates: [],
    notify: "default",
    notes: "",
    createdAt: now,
    updatedAt: now,
    taskId: task.id,
    done: false,
  };
}

/** Per day: away from the first Uni/Gym/Transport event until the last one ends. */
function awaySpans(working: Occ[], ctx: Ctx): Interval[] {
  const out: Interval[] = [];
  for (let d = 0; d < 7; d++) {
    const day = addDays(ctx.weekStart, d);
    const next = addDays(day, 1);
    const away = working.filter(
      (o) => !o.taskId && o.start < next && o.end > day && AWAY.has(ctx.catById.get(o.categoryId)?.location ?? ""),
    );
    if (away.length) out.push([Math.min(...away.map((o) => o.start)), Math.max(...away.map((o) => o.end))]);
  }
  return out;
}

function findTaskSlot(task: Task, working: Occ[], ctx: Ctx): number | null {
  const dur = task.duration * MIN;
  const windows =
    task.where === "custom" ? task.windows : [{ days: ALL_DAYS, start: ctx.homeHours.start, end: ctx.homeHours.end }];
  let ivs: Interval[] = windowIntervals(windows, ctx)
    .map(({ iv }): Interval => [Math.max(iv[0], ctx.from), Math.min(iv[1], ctx.weekEnd)])
    .filter(([s, e]) => e > s);
  ivs = subtract(ivs, windowIntervals(ctx.protectedWindows, ctx).map((x) => x.iv));
  if (task.where === "home") ivs = subtract(ivs, awaySpans(working, ctx));
  const busy = working
    .filter((o) => o.taskId || (ctx.catById.get(o.categoryId)?.blocking ?? true))
    .map((o): Interval => [o.start, o.end]);
  const candidates: { iv: Interval; travel: boolean }[] = subtract(ivs, busy).map((iv) => ({ iv, travel: false }));

  if (task.travelOk) {
    // Inside Transport blocks (e.g. an episode on the train), avoiding other tasks there.
    const travel = working
      .filter((o) => !o.taskId && ctx.catById.get(o.categoryId)?.location === "travelling")
      .map((o): Interval => [Math.max(o.start, ctx.from), o.end])
      .filter(([s, e]) => e > s);
    const otherTasks = working.filter((o) => o.taskId).map((o): Interval => [o.start, o.end]);
    candidates.push(...subtract(travel, otherTasks).map((iv) => ({ iv, travel: true })));
  }

  // Rank: a day without this task yet > travel time (dead time is ideal) > earliest.
  const usedDays = new Set(working.filter((o) => o.taskId === task.id).map((o) => dayIndex(o.start)));
  let best: { start: number; score: [number, number, number] } | null = null;
  for (const { iv: [s, e], travel } of candidates) {
    let start = snapUp(s);
    if (start + dur > e) start = s; // short gaps (e.g. inside a commute) may start off-grid
    if (start + dur > e) continue;
    const score: [number, number, number] = [usedDays.has(dayIndex(start)) ? 1 : 0, travel ? 0 : 1, start];
    if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && (score[1] < best.score[1] || (score[1] === best.score[1] && score[2] < best.score[2])))) {
      best = { start, score };
    }
  }
  return best?.start ?? null;
}

function placeTasks(working: Occ[], tasks: Task[], ctx: Ctx, plan: Plan) {
  const inWeek = (o: Occ) => o.start >= ctx.weekStart && o.start < ctx.weekEnd;
  for (const task of [...tasks].sort((a, b) => a.order - b.order)) {
    // Missed: slot ended a while ago with no tick → remove so it gets a new slot.
    for (const o of working.filter((x) => x.taskId === task.id && inWeek(x) && !x.done && x.end <= ctx.now - MISSED_GRACE)) {
      plan.remove.push(o.id);
      working.splice(working.indexOf(o), 1);
    }
    if (ctx.from >= ctx.weekEnd) continue;
    const mine = working.filter((o) => o.taskId === task.id && inWeek(o));
    const need =
      task.repeat.kind === "once"
        ? task.completedAt || mine.length || ctx.laterTaskIds.has(task.id) ? 0 : 1
        : Math.max(0, task.repeat.times - mine.length);
    for (let i = 0; i < need; i++) {
      const start = findTaskSlot(task, working, ctx);
      if (start === null) {
        plan.taskShort[task.id] = need - i;
        break;
      }
      const ev = makeTaskEvent(task, start, ctx.now + plan.add.length);
      plan.add.push(ev);
      working.push(toOcc(ev));
    }
  }
}

/** Fill shortfalls using empty time only (never moves existing events). */
export function planEmptyTime(
  events: CalEvent[],
  categories: Category[],
  settings: Settings,
  weekStart: number,
  now: number,
  tasks: Task[] = [],
): Plan {
  const ctx = makeCtx(categories, settings, weekStart, now, events);
  const working = expand(events, ctx.weekStart, ctx.weekEnd);
  return planOnOccs(working, categories, ctx, tasks);
}

/**
 * When empty time is not enough: lift the user's future Flexible blocks, place the
 * targets, then put each lifted block back as close to where it was as possible.
 * Returns null if this doesn't improve things or a lifted block can't be re-placed.
 */
export function planWithMoves(
  events: CalEvent[],
  categories: Category[],
  settings: Settings,
  weekStart: number,
  now: number,
  tasks: Task[] = [],
): Plan | null {
  const ctx = makeCtx(categories, settings, weekStart, now, events);
  const all = expand(events, ctx.weekStart, ctx.weekEnd);
  const base = planOnOccs([...all.map((o) => ({ ...o }))], categories, ctx, tasks);
  const baseLeft = Object.values(base.unplaceable).reduce((a, b) => a + b, 0);
  if (baseLeft === 0) return null;

  const lifted = all.filter((o) => o.mode === "flexible" && !o.recurring && !o.taskId && o.start >= ctx.from);
  if (!lifted.length) return null;
  const liftedIds = new Set(lifted.map((o) => o.occId));
  const working = all.filter((o) => !liftedIds.has(o.occId)).map((o) => ({ ...o }));
  const plan = planOnOccs(working, categories, ctx, tasks);
  const left = Object.values(plan.unplaceable).reduce((a, b) => a + b, 0);
  if (left >= baseLeft) return null;

  for (const o of [...lifted].sort((a, b) => b.end - b.start - (a.end - a.start))) {
    const cat = ctx.catById.get(o.categoryId);
    if (!cat) return null;
    const dur = o.end - o.start;
    let best: number | null = null;
    for (const { iv } of freeIntervals({ ...cat, id: `__moving_${cat.id}` }, working, ctx)) {
      if (iv[1] - iv[0] < dur) continue;
      const start = snapDown(Math.min(Math.max(o.start, iv[0]), iv[1] - dur));
      const s = start < iv[0] ? start + STEP : start;
      if (s + dur > iv[1]) continue;
      if (best === null || Math.abs(s - o.start) < Math.abs(best - o.start)) best = s;
    }
    if (best === null) return null;
    if (best !== o.start) plan.moves[o.baseId] = { start: best, end: best + dur };
    working.push({ ...o, start: best, end: best + dur });
  }
  return plan;
}

export function isEmptyPlan(p: Plan): boolean {
  return !p.add.length && !p.remove.length && !Object.keys(p.moves).length;
}

export function applyPlan(events: CalEvent[], plan: Plan, now: number): CalEvent[] {
  const removed = new Set(plan.remove);
  return [
    ...events
      .filter((e) => !removed.has(e.id))
      .map((e) => (plan.moves[e.id] ? { ...e, ...plan.moves[e.id], updatedAt: now } : e)),
    ...plan.add,
  ];
}
