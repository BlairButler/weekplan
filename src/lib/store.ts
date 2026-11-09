import { create } from "zustand";
import type { CalEvent, Category, Occ, Plan, Preset, Settings, Task, WeekTemplate } from "./types";
import { applyTemplate as stampTemplate } from "./templates";
import { openBackend, type Backend, type Snapshot } from "./db";
import { defaultCategories, defaultEvents, defaultPresets, defaultSettings, missingDefaultCategories } from "./defaults";
import { applyPlan, isEmptyPlan, makeTaskEvent, planEmptyTime, planWithMoves } from "./scheduler";
import { addDays, fmtHours, MIN, snapDown, startOfWeek, weekKey } from "./time";

export type View = "week" | "month" | "stats" | "settings";

export interface Editor {
  draft: CalEvent;
  occ: Occ | null; // null when creating
}

export interface Preview {
  plan: Plan;
  weekStart: number;
  reason: string;
}

export interface Toast {
  id: number;
  text: string;
  undo: boolean;
}

interface State {
  ready: boolean;
  backend: Backend | null;
  categories: Category[];
  events: CalEvent[];
  presets: Preset[];
  tasks: Task[];
  templates: WeekTemplate[];
  templatesOpen: boolean;
  settings: Settings;
  view: View;
  anchor: number; // a date inside the visible week/month
  now: number;
  preview: Preview | null;
  toast: Toast | null;
  undoStack: CalEvent[][];
  redoStack: CalEvent[][];
  editor: Editor | null;
  checkIn: Occ | null;

  init(): Promise<void>;
  setView(v: View): void;
  setAnchor(ms: number): void;
  tick(now: number): void;
  showToast(text: string, undo?: boolean): void;

  commitEvents(next: CalEvent[], opts?: { auto?: boolean; skipRefill?: boolean }): void;
  refill(): void;
  saveTask(t: Task): void;
  saveTemplate(t: WeekTemplate): void;
  deleteTemplate(id: string): void;
  applyTemplate(id: string, weekStart: number): void;
  setTemplatesOpen(open: boolean): void;
  deleteTask(id: string): void;
  setTaskBlockDone(occ: Occ, done: boolean): void;
  toggleTaskFromList(task: Task): void;
  addEvent(ev: CalEvent): void;
  updateOcc(occ: Occ, patch: Partial<CalEvent>, scope?: "this" | "series"): void;
  deleteOcc(occ: Occ, scope?: "this" | "series"): void;
  undo(): void;
  redo(): void;

  fillTargets(weekStart: number): void;
  acceptPreview(): void;
  discardPreview(): void;
  movePreviewItem(id: string, start: number, end: number): void;

  saveCategory(c: Category): void;
  deleteCategory(id: string): void;
  savePreset(p: Preset): void;
  deletePreset(id: string): void;
  saveSettings(patch: Partial<Settings>): void;

  openEditor(e: Editor | null): void;
  setCheckIn(o: Occ | null): void;
  exportSnapshot(): Snapshot;
  importSnapshot(s: Snapshot): Promise<void>;
}

const UNDO_LIMIT = 100;

function diffPersist(backend: Backend | null, prev: CalEvent[], next: CalEvent[]) {
  if (!backend) return;
  const prevById = new Map(prev.map((e) => [e.id, e]));
  const nextIds = new Set(next.map((e) => e.id));
  const upserts = next.filter((e) => prevById.get(e.id) !== e);
  const removes = prev.filter((e) => !nextIds.has(e.id)).map((e) => e.id);
  if (upserts.length) void backend.upsert("events", upserts);
  if (removes.length) void backend.remove("events", removes);
}

function describePlan(plan: Plan, cats: Category[]): string {
  const name = (id: string) => cats.find((c) => c.id === id)?.name ?? id;
  const added = new Map<string, number>();
  for (const a of plan.add) if (!a.taskId) added.set(a.categoryId, (added.get(a.categoryId) ?? 0) + (a.end - a.start) / MIN);
  const parts = [...added].map(([id, m]) => `Placed ${fmtHours(m)} ${name(id)}`);
  const tasks = plan.add.filter((a) => a.taskId);
  if (tasks.length === 1) parts.push(`Scheduled "${tasks[0].title}"`);
  else if (tasks.length > 1) parts.push(`Scheduled ${tasks.length} tasks`);
  const removedNonTask = plan.remove.length - tasks.length;
  if (removedNonTask > 0 && !tasks.length) parts.push(`removed ${removedNonTask} surplus block${removedNonTask > 1 ? "s" : ""}`);
  const moved = Object.keys(plan.moves).length;
  if (moved && !plan.add.length) parts.push(`adjusted ${moved} block${moved > 1 ? "s" : ""}`);
  return parts.join(", ");
}

export function unplaceableText(plan: Plan, cats: Category[]): string {
  return Object.entries(plan.unplaceable)
    .map(([id, m]) => `${fmtHours(m)} ${cats.find((c) => c.id === id)?.name ?? id}`)
    .join(", ");
}

let toastSeq = 0;
let initStarted = false;

export const useStore = create<State>((set, get) => ({
  ready: false,
  backend: null,
  categories: [],
  events: [],
  presets: [],
  tasks: [],
  templates: [],
  templatesOpen: false,
  settings: defaultSettings(),
  view: "week",
  anchor: Date.now(),
  now: Date.now(),
  preview: null,
  toast: null,
  undoStack: [],
  redoStack: [],
  editor: null,
  checkIn: null,

  async init() {
    if (initStarted) return;
    initStarted = true;
    const backend = await openBackend();
    const snap = await backend.load();
    let { categories, events, presets } = snap;
    const tasks = snap.tasks ?? [];
    const templates = snap.templates ?? [];
    const settings = { ...defaultSettings(), ...(snap.settings ?? {}) };
    if (!categories.length) {
      categories = defaultCategories();
      presets = defaultPresets();
      events = defaultEvents(Date.now());
      await backend.replaceAll({ categories, events, presets, tasks, templates, settings });
    } else {
      const added = missingDefaultCategories(categories);
      if (added.length) {
        categories = [...categories, ...added];
        await backend.upsert("categories", added);
      }
    }
    set({ backend, categories, events, presets, tasks, templates, settings, ready: true });
    get().tick(Date.now());
  },

  setView: (view) => set({ view }),
  setAnchor: (anchor) => set({ anchor }),

  tick(now) {
    set({ now });
    // Snapshot this week's targets so history keeps the targets that applied at the time.
    const key = weekKey(startOfWeek(now));
    const { settings, categories } = get();
    if (!settings.weekTargets[key]) {
      const targets: Record<string, number> = {};
      for (const c of categories) if (c.targetHours) targets[c.id] = c.targetHours;
      get().saveSettings({ weekTargets: { ...settings.weekTargets, [key]: targets } });
    }
  },

  showToast(text, undo = false) {
    const id = ++toastSeq;
    set({ toast: { id, text, undo } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, undo ? 8000 : 5000);
  },

  commitEvents(next, opts = {}) {
    const { events: prev, backend } = get();
    set((s) => ({ events: next, undoStack: [...s.undoStack, prev].slice(-UNDO_LIMIT), redoStack: [] }));
    diffPersist(backend, prev, next);
    if (opts.auto || opts.skipRefill) return;

    get().refill();
  },

  /** Hybrid auto-refill for the current week, once it has been planned. */
  refill() {
    const { now, categories, settings, tasks, events } = get();
    const week = startOfWeek(now);
    if (!settings.plannedWeeks.includes(weekKey(week))) return;
    const plan = planEmptyTime(events, categories, settings, week, now, tasks);
    if (!isEmptyPlan(plan)) {
      const after = applyPlan(events, plan, now);
      get().commitEvents(after, { auto: true });
      get().showToast(describePlan(plan, categories), true);
    }
    if (Object.keys(plan.unplaceable).length) {
      const latest = get().events;
      const moved = planWithMoves(latest, categories, settings, week, now, tasks);
      if (moved && !isEmptyPlan(moved)) {
        set({ preview: { plan: moved, weekStart: week, reason: "Not enough empty time: suggested moves to stay on target" } });
      } else {
        get().showToast(`Couldn't fit ${unplaceableText(plan, categories)} this week`);
      }
    }
  },

  saveTask(t) {
    const ts = get().tasks;
    const prev = ts.find((x) => x.id === t.id);
    set({ tasks: prev ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t] });
    void get().backend?.upsert("tasks", [t]);
    // Keep upcoming blocks in sync with edits (title/category/length), then refill.
    if (prev) {
      const now = Date.now();
      const next = get().events.map((e) =>
        e.taskId === t.id && !e.done && e.start >= now
          ? { ...e, title: t.title, categoryId: t.categoryId, end: e.start + t.duration * MIN, updatedAt: now }
          : e,
      );
      const changed = next.some((e, i) => e !== get().events[i]);
      if (changed) {
        // drop upcoming blocks if where/when rules changed so they get re-placed
        const rulesChanged = prev.where !== t.where || prev.travelOk !== t.travelOk || JSON.stringify(prev.windows) !== JSON.stringify(t.windows) || JSON.stringify(prev.repeat) !== JSON.stringify(t.repeat) || prev.duration !== t.duration;
        get().commitEvents(rulesChanged ? next.filter((e) => !(e.taskId === t.id && !e.done && e.start >= now)) : next);
        return;
      }
    }
    get().refill();
  },

  saveTemplate(t) {
    const ts = get().templates;
    set({ templates: ts.some((x) => x.id === t.id) ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t] });
    void get().backend?.upsert("templates", [t]);
  },

  deleteTemplate(id) {
    set({ templates: get().templates.filter((t) => t.id !== id) });
    void get().backend?.remove("templates", [id]);
  },

  applyTemplate(id, weekStart) {
    const tpl = get().templates.find((t) => t.id === id);
    if (!tpl) return;
    get().commitEvents(stampTemplate(get().events, tpl, weekStart, Date.now()));
    get().showToast(`Applied "${tpl.name}" (${tpl.items.length} event${tpl.items.length === 1 ? "" : "s"})`, true);
  },

  setTemplatesOpen: (templatesOpen) => set({ templatesOpen }),

  deleteTask(id) {
    set({ tasks: get().tasks.filter((t) => t.id !== id) });
    void get().backend?.remove("tasks", [id]);
    const now = Date.now();
    // remove upcoming blocks; keep done/past ones as a record
    get().commitEvents(get().events.filter((e) => !(e.taskId === id && !e.done && e.end > now)), { skipRefill: true });
  },

  setTaskBlockDone(occ, done) {
    const task = get().tasks.find((t) => t.id === occ.taskId);
    if (task?.repeat.kind === "once") {
      const t = { ...task, completedAt: done ? Date.now() : null };
      set({ tasks: get().tasks.map((x) => (x.id === t.id ? t : x)) });
      void get().backend?.upsert("tasks", [t]);
    }
    get().updateOcc(occ, { done });
  },

  toggleTaskFromList(task) {
    const { events, now } = get();
    const week = startOfWeek(now);
    const weekEnd = addDays(week, 7);
    const blocks = events.filter((e) => e.taskId === task.id).sort((a, b) => a.start - b.start);
    const scope = task.repeat.kind === "once" ? blocks : blocks.filter((e) => e.start >= week && e.start < weekEnd);
    const doneCount = scope.filter((e) => e.done).length;
    const complete = task.repeat.kind === "once" ? !!task.completedAt : doneCount >= task.repeat.times;
    const asOcc = (e: CalEvent): Occ => ({ ...e, occId: e.id, baseId: e.id, origStart: e.start, recurring: false });
    if (complete) {
      const last = [...scope].reverse().find((e) => e.done);
      if (last) get().setTaskBlockDone(asOcc(last), false);
      else if (task.repeat.kind === "once") get().saveTask({ ...task, completedAt: null });
      return;
    }
    const open = scope.find((e) => !e.done);
    if (open) {
      get().setTaskBlockDone(asOcc(open), true);
    } else {
      // Done without a block: record it now.
      const ev = { ...makeTaskEvent(task, snapDown(now), Date.now()), done: true };
      if (task.repeat.kind === "once") {
        const t = { ...task, completedAt: Date.now() };
        set({ tasks: get().tasks.map((x) => (x.id === t.id ? t : x)) });
        void get().backend?.upsert("tasks", [t]);
      }
      get().addEvent(ev);
    }
  },

  addEvent(ev) {
    get().commitEvents([...get().events, ev]);
  },

  updateOcc(occ, patch, scope = "this") {
    const now = Date.now();
    const events = get().events;
    if (!occ.recurring) {
      get().commitEvents(events.map((e) => (e.id === occ.baseId ? { ...e, ...patch, updatedAt: now } : e)));
      return;
    }
    if (scope === "series") {
      const base = events.find((e) => e.id === occ.baseId)!;
      const shift = (patch.start ?? occ.start) - occ.start;
      const dur = (patch.end ?? occ.end) - (patch.start ?? occ.start);
      const start = base.start + shift;
      get().commitEvents(
        events.map((e) => (e.id === base.id ? { ...e, ...patch, start, end: start + dur, updatedAt: now } : e)),
      );
      return;
    }
    // Detach this occurrence into a one-off event.
    const detached: CalEvent = {
      ...stripOcc(occ),
      ...patch,
      id: crypto.randomUUID(),
      recurrence: null,
      exdates: [],
      createdAt: occ.createdAt,
      updatedAt: now,
    };
    get().commitEvents([
      ...events.map((e) => (e.id === occ.baseId ? { ...e, exdates: [...e.exdates, occ.origStart] } : e)),
      detached,
    ]);
  },

  deleteOcc(occ, scope = "this") {
    const events = get().events;
    if (!occ.recurring || scope === "series") {
      get().commitEvents(events.filter((e) => e.id !== occ.baseId));
    } else {
      get().commitEvents(events.map((e) => (e.id === occ.baseId ? { ...e, exdates: [...e.exdates, occ.origStart] } : e)));
    }
  },

  undo() {
    const { undoStack, events, backend } = get();
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    set((s) => ({ events: prev, undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, events], toast: null }));
    diffPersist(backend, events, prev);
  },

  redo() {
    const { redoStack, events, backend } = get();
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    set((s) => ({ events: next, redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, events] }));
    diffPersist(backend, events, next);
  },

  fillTargets(weekStart) {
    const { events, categories, settings, now } = get();
    if (addDays(weekStart, 7) <= now) {
      get().showToast("That week is already over");
      return;
    }
    const { tasks } = get();
    let plan = planEmptyTime(events, categories, settings, weekStart, now, tasks);
    let reason = "Proposed target-fill and task blocks";
    if (Object.keys(plan.unplaceable).length) {
      const moved = planWithMoves(events, categories, settings, weekStart, now, tasks);
      if (moved) {
        plan = moved;
        reason = "Includes moving some flexible blocks to make room";
      }
    }
    if (isEmptyPlan(plan) && !Object.keys(plan.unplaceable).length) {
      get().showToast("Targets already met for this week");
      get().saveSettings({ plannedWeeks: [...new Set([...settings.plannedWeeks, weekKey(weekStart)])] });
      return;
    }
    set({ preview: { plan, weekStart, reason } });
  },

  acceptPreview() {
    const { preview, events, settings } = get();
    if (!preview) return;
    get().commitEvents(applyPlan(events, preview.plan, Date.now()), { skipRefill: true });
    get().saveSettings({ plannedWeeks: [...new Set([...settings.plannedWeeks, weekKey(preview.weekStart)])] });
    set({ preview: null });
  },

  discardPreview: () => set({ preview: null }),

  movePreviewItem(id, start, end) {
    const p = get().preview;
    if (!p) return;
    const plan: Plan = {
      ...p.plan,
      add: p.plan.add.map((a) => (a.id === id ? { ...a, start, end } : a)),
      moves: p.plan.moves[id] ? { ...p.plan.moves, [id]: { start, end } } : p.plan.moves,
    };
    set({ preview: { ...p, plan } });
  },

  saveCategory(c) {
    const cats = get().categories;
    const exists = cats.some((x) => x.id === c.id);
    set({ categories: exists ? cats.map((x) => (x.id === c.id ? c : x)) : [...cats, c] });
    void get().backend?.upsert("categories", [c]);
  },

  deleteCategory(id) {
    set({ categories: get().categories.filter((c) => c.id !== id) });
    void get().backend?.remove("categories", [id]);
  },

  savePreset(p) {
    const ps = get().presets;
    set({ presets: ps.some((x) => x.id === p.id) ? ps.map((x) => (x.id === p.id ? p : x)) : [...ps, p] });
    void get().backend?.upsert("presets", [p]);
  },

  deletePreset(id) {
    set({ presets: get().presets.filter((p) => p.id !== id) });
    void get().backend?.remove("presets", [id]);
  },

  saveSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    void get().backend?.saveSettings(settings);
  },

  openEditor: (editor) => set({ editor }),
  setCheckIn: (checkIn) => set({ checkIn }),

  exportSnapshot() {
    const { categories, events, presets, tasks, templates, settings } = get();
    return { categories, events, presets, tasks, templates, settings };
  },

  async importSnapshot(s) {
    const settings = { ...defaultSettings(), ...(s.settings ?? {}) };
    const tasks = s.tasks ?? [];
    const templates = s.templates ?? [];
    await get().backend?.replaceAll({ ...s, tasks, templates, settings });
    set({ categories: s.categories, events: s.events, presets: s.presets, tasks, templates, settings, undoStack: [], redoStack: [] });
  },
}));

export function stripOcc(o: Occ): CalEvent {
  const { occId: _a, baseId: _b, origStart: _c, recurring: _d, ghost: _e, ...ev } = o;
  return ev;
}
