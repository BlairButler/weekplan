import type { CalEvent, Category, PlacementRules, Preset, Settings, Task } from "./types";
import { addDays, atMinutes, startOfWeek } from "./time";

/** 16 colours chosen to stay distinguishable in both light and dark mode. */
export const PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
  "#6366f1", "#84cc16", "#06b6d4", "#e11d48", "#a855f7", "#0ea5e9", "#64748b", "#78716c",
];

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function defaultRules(over: Partial<PlacementRules> = {}): PlacementRules {
  return {
    windows: [{ days: ALL_DAYS, start: 8 * 60, end: 20 * 60 }],
    minBlock: 60,
    maxBlock: 120,
    maxPerDay: 240,
    buffer: 0,
    preference: "spread",
    ...over,
  };
}

type Seed = Partial<Category> & Pick<Category, "id" | "name" | "colour">;

const SEEDS: Seed[] = [
  {
    id: "research", name: "Research", colour: "#3b82f6", defaultMode: "flexible", location: "neutral",
    targetHours: 30, checkIn: true,
    rules: defaultRules({ windows: [{ days: ALL_DAYS, start: 8 * 60, end: 18 * 60 }], minBlock: 60, maxBlock: 240, maxPerDay: 480, buffer: 15, preference: "earliest" }),
  },
  {
    id: "gym", name: "Gym", colour: "#10b981", defaultMode: "flexible", location: "gym", targetHours: 8,
    rules: defaultRules({ windows: [{ days: ALL_DAYS, start: 6 * 60, end: 21 * 60 }], minBlock: 120, maxBlock: 120, maxPerDay: 120, preference: "spread" }),
  },
  { id: "teaching", name: "Teaching", colour: "#f59e0b", location: "uni" },
  { id: "marking", name: "Marking", colour: "#f97316", location: "neutral" },
  { id: "meetings", name: "Meetings", colour: "#8b5cf6", location: "uni" },
  { id: "lectures", name: "Lectures", colour: "#6366f1", location: "uni" },
  { id: "transport", name: "Transport", colour: "#64748b", location: "travelling", notify: 10 },
  { id: "sleep", name: "Sleep", colour: "#78716c", location: "home", muted: true, notify: "none" },
  { id: "climbing", name: "Rock Climbing", colour: "#ef4444", location: "neutral" },
  { id: "rovers", name: "Rovers", colour: "#14b8a6", location: "neutral" },
  { id: "procreate", name: "Procreate", colour: "#ec4899", location: "home" },
  { id: "leisure", name: "Leisure", colour: "#84cc16", location: "home", blocking: false },
  { id: "chores", name: "Chores", colour: "#06b6d4", location: "home", notify: "none" },
];

export function defaultCategories(): Category[] {
  return SEEDS.map((s, i) => ({
    defaultMode: "fixed",
    location: "neutral",
    targetHours: null,
    rules: defaultRules(),
    notify: "default",
    checkIn: false,
    blocking: true,
    muted: false,
    ...s,
    order: i,
  }));
}

export function defaultPresets(): Preset[] {
  const p: [string, string, number][] = [
    ["Commute", "transport", 90],
    ["Research", "research", 240],
    ["Research", "research", 120],
    ["Gym", "gym", 120],
    ["Teaching", "teaching", 60],
    ["Marking", "marking", 120],
    ["Meeting", "meetings", 60],
    ["Lecture", "lectures", 120],
    ["Rock Climbing", "climbing", 120],
    ["Rovers", "rovers", 180],
    ["Procreate", "procreate", 120],
    ["Star Trek", "leisure", 45],
  ];
  return p.map(([title, categoryId, duration], i) => ({ id: `preset-${i}`, title, categoryId, duration, order: i }));
}

export function defaultSettings(): Settings {
  return {
    defaultNotify: 15,
    protectedWindows: [],
    backupDir: null,
    lastBackup: null,
    planReminder: true,
    plannedWeeks: [],
    weekTargets: {},
    checkedIn: [],
    notified: [],
    homeHours: { start: 7 * 60, end: 21 * 60 + 30 },
  };
}

/** Recurring sleep: 10pm–6am Sun–Thu nights, midnight–8am after Fri & Sat nights. */
export function defaultEvents(now: number): CalEvent[] {
  const monday = startOfWeek(now);
  const base = { categoryId: "sleep", title: "Sleep", mode: "fixed" as const, source: "manual" as const, exdates: [], notify: "default" as const, notes: "", createdAt: 0, updatedAt: 0 };
  const weeknight = atMinutes(addDays(monday, -1), 22 * 60); // Sunday before, 10pm
  const weekend = atMinutes(addDays(monday, 5), 0); // Saturday 00:00
  return [
    { ...base, id: "sleep-weeknights", start: weeknight, end: weeknight + 8 * 3600_000, recurrence: { days: [6, 0, 1, 2, 3], until: null } },
    { ...base, id: "sleep-weekends", start: weekend, end: weekend + 8 * 3600_000, recurrence: { days: [5, 6], until: null } },
  ];
}

/** Categories added after first release; merged into existing installs on load. */
export function missingDefaultCategories(existing: Category[]): Category[] {
  const have = new Set(existing.map((c) => c.id));
  const maxOrder = Math.max(0, ...existing.map((c) => c.order));
  return defaultCategories()
    .filter((c) => c.id === "chores" && !have.has(c.id))
    .map((c, i) => ({ ...c, order: maxOrder + 1 + i }));
}

export function newTask(over: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "",
    categoryId: "chores",
    duration: 15,
    where: "home",
    travelOk: false,
    windows: [{ days: [5, 6], start: 10 * 60, end: 18 * 60 }],
    repeat: { kind: "weekly", times: 1 },
    completedAt: null,
    order: Date.now(),
    createdAt: Date.now(),
    ...over,
  };
}
