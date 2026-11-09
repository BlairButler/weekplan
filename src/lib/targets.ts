import type { Occ } from "./types";
import { addDays, COUNT_STEP, MIN } from "./time";

const STEP = COUNT_STEP * MIN;

/**
 * Assigns each COUNT_STEP slot in [from, to) to at most one event, so overlapping
 * time is never counted twice. The most recently placed event (createdAt) wins.
 */
export function slotWinners(occs: Occ[], from: number, to: number): Map<number, Occ> {
  const winners = new Map<number, Occ>();
  const sorted = [...occs].sort((a, b) => a.createdAt - b.createdAt || a.occId.localeCompare(b.occId));
  for (const o of sorted) {
    const s = Math.max(o.start, from);
    const e = Math.min(o.end, to);
    for (let t = s - (s % STEP); t < e; t += STEP) {
      if (t >= from) winners.set(t, o);
    }
  }
  return winners;
}

export interface Totals {
  done: number; // minutes already elapsed
  scheduled: number; // minutes in the week overall (including done)
}

export function weekTotals(occs: Occ[], weekStart: number, now: number): Map<string, Totals> {
  const weekEnd = addDays(weekStart, 7);
  const totals = new Map<string, Totals>();
  for (const [t, o] of slotWinners(occs, weekStart, weekEnd)) {
    const cur = totals.get(o.categoryId) ?? { done: 0, scheduled: 0 };
    cur.scheduled += COUNT_STEP;
    if (t + STEP <= now) cur.done += COUNT_STEP;
    totals.set(o.categoryId, cur);
  }
  return totals;
}

/** Counted minutes per weekday (0 = Mon) for one category. */
export function dayUsage(occs: Occ[], categoryId: string, weekStart: number): number[] {
  const usage = [0, 0, 0, 0, 0, 0, 0];
  const winners = slotWinners(occs, weekStart, addDays(weekStart, 7));
  const dayStarts = Array.from({ length: 8 }, (_, i) => addDays(weekStart, i));
  for (const [t, o] of winners) {
    if (o.categoryId !== categoryId) continue;
    const d = dayStarts.findIndex((ds, i) => t >= ds && t < dayStarts[i + 1]);
    if (d >= 0 && d < 7) usage[d] += COUNT_STEP;
  }
  return usage;
}
