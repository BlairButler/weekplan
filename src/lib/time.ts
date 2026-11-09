export const MIN = 60_000;
export const SNAP = 30; // drag / placement grid (minutes)
export const COUNT_STEP = 15; // accounting resolution, finer than SNAP so older :15 events still count exactly
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Calendar-day arithmetic (DST-safe). */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime();
}

/** 0 = Monday … 6 = Sunday */
export function dayIndex(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

export function startOfWeek(ms: number): number {
  const day = startOfDay(ms);
  return addDays(day, -dayIndex(day));
}

export function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

/** Instant at `minutes` past local midnight of the given day. */
export function atMinutes(dayMs: number, minutes: number): number {
  const d = new Date(dayMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes).getTime();
}

export function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

export function snapDown(ms: number, step = SNAP): number {
  const day = startOfDay(ms);
  return atMinutes(day, Math.floor(minutesOfDay(ms) / step) * step);
}

export function snapUp(ms: number, step = SNAP): number {
  const down = snapDown(ms, step);
  return down === ms ? down : down + step * MIN;
}

export function weekKey(weekStart: number): string {
  const d = new Date(weekStart);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
}

export function fmtMinutesOfDay(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function fmtHours(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function fmtDateShort(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function fmtWeekRange(weekStart: number): string {
  const end = addDays(weekStart, 6);
  const a = new Date(weekStart);
  const b = new Date(end);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString(undefined, { day: "numeric", month: sameMonth ? undefined : "short" });
  const right = b.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `${left} – ${right}`;
}

export function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function uid(): string {
  return crypto.randomUUID();
}
