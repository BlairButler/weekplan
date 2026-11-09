/** Minutes are used for durations/time-of-day; epoch milliseconds for instants. */

export type Mode = "fixed" | "flexible" | "target-fill" | "task";
export type Place = "home" | "uni" | "gym" | "travelling" | "neutral";
export type NotifySetting = "default" | "none" | number; // number = minutes before

/** days: 0 = Monday … 6 = Sunday. start/end: minutes from midnight (end may be 1440). */
export interface TimeWindow {
  days: number[];
  start: number;
  end: number;
}

export interface PlacementRules {
  windows: TimeWindow[];
  minBlock: number;
  maxBlock: number;
  maxPerDay: number;
  buffer: number;
  preference: "earliest" | "spread";
}

export interface Category {
  id: string;
  name: string;
  colour: string;
  defaultMode: "fixed" | "flexible";
  location: Place;
  targetHours: number | null;
  rules: PlacementRules;
  notify: NotifySetting;
  checkIn: boolean;
  blocking: boolean;
  muted: boolean;
  order: number;
}

export interface Recurrence {
  days: number[]; // weekdays (0 = Mon) on which an occurrence starts
  until: number | null;
}

export interface CalEvent {
  id: string;
  title: string;
  categoryId: string;
  start: number;
  end: number;
  mode: Mode;
  source: "manual" | "preset" | "target-fill" | "task" | "template" | "outlook";
  recurrence: Recurrence | null;
  exdates: number[]; // original starts of skipped/detached occurrences
  notify: NotifySetting;
  notes: string;
  createdAt: number;
  updatedAt: number;
  taskId?: string | null; // set on blocks placed for a Task
  done?: boolean; // task blocks: ticked off
  templateId?: string | null; // set on events stamped from a week template
}

/** A concrete, displayable instance (one-off event or an expanded recurring occurrence). */
export interface Occ extends CalEvent {
  occId: string;
  baseId: string;
  origStart: number;
  recurring: boolean;
  ghost?: "new" | "moved";
}

export type TaskWhere = "home" | "anywhere" | "custom";

export type TaskRepeat = { kind: "once"; due: number | null } | { kind: "weekly"; times: number };

/** A chore / to-do that the scheduler slots into free time. */
export interface Task {
  id: string;
  title: string;
  categoryId: string;
  duration: number; // minutes
  where: TaskWhere;
  travelOk: boolean; // may also go inside Transport blocks
  windows: TimeWindow[]; // used when where = "custom"
  repeat: TaskRepeat;
  completedAt: number | null; // one-off tasks
  order: number;
  createdAt: number;
}

/** One event inside a week template, positioned relative to Monday. */
export interface TemplateItem {
  title: string;
  categoryId: string;
  day: number; // 0 = Monday
  start: number; // minutes from midnight
  duration: number; // minutes
  mode: "fixed" | "flexible";
  notify: NotifySetting;
  notes: string;
}

export interface WeekTemplate {
  id: string;
  name: string;
  items: TemplateItem[];
  order: number;
  createdAt: number;
}

export interface Preset {
  id: string;
  title: string;
  categoryId: string;
  duration: number;
  order: number;
}

export interface Settings {
  defaultNotify: number;
  protectedWindows: TimeWindow[];
  backupDir: string | null;
  lastBackup: number | null;
  planReminder: boolean;
  plannedWeeks: string[]; // weeks where auto-refill is active
  weekTargets: Record<string, Record<string, number>>; // weekKey -> catId -> hours
  checkedIn: string[];
  notified: string[];
  homeHours: { start: number; end: number }; // tasks are never placed outside these
}

export interface Plan {
  add: CalEvent[];
  remove: string[];
  moves: Record<string, { start: number; end: number }>;
  unplaceable: Record<string, number>; // catId -> minutes
  taskShort: Record<string, number>; // taskId -> instances that didn't fit
}
