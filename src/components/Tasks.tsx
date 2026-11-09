import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { newTask } from "../lib/defaults";
import { planEmptyTime } from "../lib/scheduler";
import { FALLBACK_CATEGORY, useCategoryMap } from "../lib/selectors";
import { addDays, DAY_SHORT, dayIndex, fmtHours, fmtTime, startOfWeek, weekKey } from "../lib/time";
import type { Task } from "../lib/types";
import { ModeIcon } from "./icons";
import { WindowsEditor } from "./SettingsView";

function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function whereText(t: Task): string {
  const base = t.where === "home" ? "Home" : t.where === "anywhere" ? "Anywhere" : "Set times";
  return t.travelOk ? `${base} or travelling` : base;
}

export function TasksPanel() {
  const tasks = useStore((s) => s.tasks);
  const events = useStore((s) => s.events);
  const categories = useStore((s) => s.categories);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const { toggleTaskFromList, deleteTask } = useStore.getState();
  const catMap = useCategoryMap();
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);

  const week = startOfWeek(now);
  const weekEnd = addDays(week, 7);
  const planned = settings.plannedWeeks.includes(weekKey(week));
  const short = useMemo(
    () => (planned ? planEmptyTime(events, categories, settings, week, now, tasks).taskShort : {}),
    [planned, events, categories, settings, week, now, tasks],
  );

  const active = tasks.filter((t) => !(t.repeat.kind === "once" && t.completedAt)).sort((a, b) => a.order - b.order);
  const done = tasks.filter((t) => t.repeat.kind === "once" && t.completedAt);

  return (
    <div className="tasks">
      <button className="add-task" onClick={() => setEditing(newTask({ order: Date.now() }))}>
        + Add task
      </button>
      {!planned && <p className="hint">Tasks are scheduled once this week is planned (Fill targets & tasks, on the right).</p>}
      {active.length === 0 && <p className="hint">No tasks yet. Add chores or anything you want slotted into free time.</p>}
      <ul className="task-list">
        {active.map((t) => {
          const c = catMap.get(t.categoryId) ?? FALLBACK_CATEGORY;
          const blocks = events.filter((e) => e.taskId === t.id);
          const thisWeek = blocks.filter((e) => e.start >= week && e.start < weekEnd);
          const doneN = (t.repeat.kind === "once" ? blocks : thisWeek).filter((e) => e.done).length;
          const target = t.repeat.kind === "once" ? 1 : t.repeat.times;
          const checked = t.repeat.kind === "once" ? !!t.completedAt : doneN >= target;
          const next = blocks.filter((e) => !e.done && e.end > now).sort((a, b) => a.start - b.start)[0];
          const overdue = t.repeat.kind === "once" && t.repeat.due !== null && t.repeat.due < now;
          return (
            <li key={t.id} className={`task-row ${checked ? "is-done" : ""}`} style={{ ["--c" as string]: c.colour }}>
              <button className="task-box" onClick={() => toggleTaskFromList(t)} aria-label={checked ? "Mark not done" : "Mark done"}>
                <ModeIcon mode="task" done={checked} />
              </button>
              <button className="task-main" onClick={() => setEditing(t)}>
                <span className="task-title">
                  {t.title || "Untitled"}
                  {overdue && <span className="badge warn-badge">overdue</span>}
                </span>
                <span className="task-meta">
                  {fmtHours(t.duration)} · {whereText(t)} ·{" "}
                  {t.repeat.kind === "once" ? (t.repeat.due ? `due ${new Date(t.repeat.due).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "once") : `${t.repeat.times}×/week`}
                  {t.repeat.kind === "weekly" && t.repeat.times > 1 && ` · ${doneN}/${target}`}
                </span>
                <span className="task-when">
                  {short[t.id] ? (
                    <span className="warn">Won't fit this week</span>
                  ) : next ? (
                    `Next: ${DAY_SHORT[dayIndex(next.start)]} ${fmtTime(next.start)}`
                  ) : checked ? (
                    "Done"
                  ) : planned ? (
                    "Not scheduled"
                  ) : (
                    ""
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {done.length > 0 && (
        <div className="task-done">
          <button className="link" onClick={() => setShowDone(!showDone)}>
            {showDone ? "▾" : "▸"} Done ({done.length})
          </button>
          {showDone && (
            <>
              <ul className="task-list">
                {done.map((t) => (
                  <li key={t.id} className="task-row is-done" style={{ ["--c" as string]: (catMap.get(t.categoryId) ?? FALLBACK_CATEGORY).colour }}>
                    <button className="task-box" onClick={() => toggleTaskFromList(t)} aria-label="Mark not done">
                      <ModeIcon mode="task" done />
                    </button>
                    <span className="task-main">
                      <span className="task-title">{t.title}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <button className="link" onClick={() => done.forEach((t) => deleteTask(t.id))}>
                Clear done tasks
              </button>
            </>
          )}
        </div>
      )}
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const categories = useStore((s) => s.categories);
  const exists = useStore((s) => s.tasks.some((t) => t.id === task.id));
  const { saveTask, deleteTask } = useStore.getState();
  const [t, setT] = useState<Task>(task);
  const set = (patch: Partial<Task>) => setT({ ...t, ...patch });

  const save = () => {
    const cat = categories.find((c) => c.id === t.categoryId);
    saveTask({ ...t, title: t.title.trim() || cat?.name || "Task", duration: Math.max(5, t.duration) });
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>{exists ? "Edit task" : "New task"}</h2>
        <label>
          Task
          <input autoFocus placeholder="e.g. Clean toilet" value={t.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <div className="row">
          <label>
            Category
            <select value={t.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Takes (minutes)
            <input type="number" min={5} step={5} value={t.duration} onChange={(e) => set({ duration: Number(e.target.value) })} />
          </label>
        </div>
        <fieldset>
          <legend>Where / when</legend>
          <label className="check">
            <input type="radio" checked={t.where === "home"} onChange={() => set({ where: "home" })} />
            When I'm home (worked out from your week, within home hours)
          </label>
          <label className="check">
            <input type="radio" checked={t.where === "anywhere"} onChange={() => set({ where: "anywhere" })} />
            Anywhere, any free time within home hours
          </label>
          <label className="check">
            <input type="radio" checked={t.where === "custom"} onChange={() => set({ where: "custom" })} />
            Only at specific times
          </label>
          {t.where === "custom" && <WindowsEditor windows={t.windows} onChange={(windows) => set({ windows })} />}
          <label className="check">
            <input type="checkbox" checked={t.travelOk} onChange={(e) => set({ travelOk: e.target.checked })} />
            Can also be done while travelling (placed inside Transport blocks)
          </label>
        </fieldset>
        <fieldset>
          <legend>How often</legend>
          <div className="row align-end">
            <label>
              Repeat
              <select
                value={t.repeat.kind}
                onChange={(e) => set({ repeat: e.target.value === "once" ? { kind: "once", due: null } : { kind: "weekly", times: 1 } })}
              >
                <option value="weekly">Every week</option>
                <option value="once">Once</option>
              </select>
            </label>
            {t.repeat.kind === "weekly" ? (
              <label>
                Times per week
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={t.repeat.times}
                  onChange={(e) => set({ repeat: { kind: "weekly", times: Math.max(1, Number(e.target.value)) } })}
                />
              </label>
            ) : (
              <label>
                Due (optional)
                <input
                  type="date"
                  value={t.repeat.due ? toDateInput(t.repeat.due) : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    const [y, m, d] = v.split("-").map(Number);
                    set({ repeat: { kind: "once", due: v ? new Date(y, m - 1, d, 23, 59).getTime() : null } });
                  }}
                />
              </label>
            )}
          </div>
        </fieldset>
        <div className="modal-actions">
          {exists && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                deleteTask(t.id);
                onClose();
              }}
            >
              Delete task
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
