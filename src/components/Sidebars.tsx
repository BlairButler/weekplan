import { useMemo, useState } from "react";
import { TasksPanel } from "./Tasks";
import { startPaletteDrag, usePaletteDrag } from "../lib/paletteDrag";
import { unplaceableText, useStore } from "../lib/store";
import { FALLBACK_CATEGORY, useCategoryMap, useOccurrences } from "../lib/selectors";
import { weekTotals } from "../lib/targets";
import { planEmptyTime } from "../lib/scheduler";
import { ModeIcon } from "./icons";
import { addDays, fmtHours, startOfWeek, weekKey } from "../lib/time";

export function Palette() {
  const presets = useStore((s) => s.presets);
  const catMap = useCategoryMap();
  const sorted = [...presets].sort((a, b) => a.order - b.order);
  const drag = usePaletteDrag((st) => st.drag);
  const dragCat = drag ? (catMap.get(drag.preset.categoryId) ?? FALLBACK_CATEGORY) : null;
  const [tab, setTab] = useState<"palette" | "tasks">(() => {
    try {
      return localStorage.getItem("weekplan:sidebarTab") === "tasks" ? "tasks" : "palette";
    } catch {
      return "palette";
    }
  });
  const choose = (t: "palette" | "tasks") => {
    setTab(t);
    try {
      localStorage.setItem("weekplan:sidebarTab", t);
    } catch {
      /* ignore */
    }
  };
  return (
    <aside className="sidebar palette">
      <div className="side-tabs">
        <button className={tab === "palette" ? "is-on" : ""} onClick={() => choose("palette")}>
          Palette
        </button>
        <button className={tab === "tasks" ? "is-on" : ""} onClick={() => choose("tasks")}>
          Tasks
        </button>
      </div>
      {tab === "tasks" ? (
        <TasksPanel />
      ) : (
        <>
          {drag?.moved && dragCat && (
            <div className="palette-item palette-float" style={{ left: drag.x + 8, top: drag.y + 8, ["--c" as string]: dragCat.colour }}>
              <span className="palette-title">{drag.preset.title}</span>
              <span className="palette-dur">{fmtHours(drag.preset.duration)}</span>
            </div>
          )}
          <p className="hint">Drag onto the week</p>
          <div className="palette-list">
            {sorted.map((p) => {
              const c = catMap.get(p.categoryId) ?? FALLBACK_CATEGORY;
              return (
                <div key={p.id} className="palette-item" style={{ ["--c" as string]: c.colour }} onPointerDown={(e) => startPaletteDrag(e, p)}>
                  <span className="palette-title">{p.title}</span>
                  <span className="palette-dur">{fmtHours(p.duration)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}

export function TargetsPanel() {
  const anchor = useStore((s) => s.anchor);
  const now = useStore((s) => s.now);
  const categories = useStore((s) => s.categories);
  const settings = useStore((s) => s.settings);
  const events = useStore((s) => s.events);
  const preview = useStore((s) => s.preview);
  const tasks = useStore((s) => s.tasks);
  const { fillTargets, setTemplatesOpen } = useStore.getState();
  const catMap = useCategoryMap();
  const weekStart = startOfWeek(anchor);
  const occs = useOccurrences(weekStart, addDays(weekStart, 7), false);
  const totals = useMemo(() => weekTotals(occs, weekStart, now), [occs, weekStart, now]);
  const planned = settings.plannedWeeks.includes(weekKey(weekStart));
  const isPast = addDays(weekStart, 7) <= now;
  const snapshot = settings.weekTargets[weekKey(weekStart)];

  const targets = categories
    .filter((c) => (isPast && snapshot ? snapshot[c.id] : c.targetHours))
    .sort((a, b) => a.order - b.order);
  const others = categories
    .filter((c) => !targets.includes(c) && !c.muted && (totals.get(c.id)?.scheduled ?? 0) > 0)
    .sort((a, b) => (totals.get(b.id)?.scheduled ?? 0) - (totals.get(a.id)?.scheduled ?? 0));

  const shortfall = useMemo(
    () => (isPast ? {} : planEmptyTime(events, categories, settings, weekStart, now, tasks).unplaceable),
    [events, categories, settings, weekStart, now, isPast, tasks],
  );

  return (
    <aside className="sidebar targets">
      <h3>This week</h3>
      {targets.map((c) => {
        const t = totals.get(c.id) ?? { done: 0, scheduled: 0 };
        const target = ((isPast && snapshot?.[c.id]) || c.targetHours || 0) * 60;
        const pctDone = Math.min(100, (t.done / target) * 100);
        const pctSched = Math.min(100, (t.scheduled / target) * 100);
        return (
          <div key={c.id} className="target" style={{ ["--c" as string]: c.colour }}>
            <div className="target-row">
              <span className="target-name">{c.name}</span>
              <span className="target-num">
                <b>{fmtHours(t.done)}</b> / {fmtHours(target)}
              </span>
            </div>
            <div className="bar">
              <div className="bar-sched" style={{ width: `${pctSched}%` }} />
              <div className="bar-done" style={{ width: `${pctDone}%` }} />
            </div>
            <div className="target-sub">
              {fmtHours(t.scheduled)} scheduled
              {t.scheduled < target && !isPast && <span className="warn"> · {fmtHours(target - t.scheduled)} short</span>}
              {shortfall[c.id] && planned && <span className="warn"> ({fmtHours(shortfall[c.id])} won't fit)</span>}
            </div>
          </div>
        );
      })}
      {!isPast && (
        <div className="plan-box">
          {planned ? (
            <>
              <p className="hint">Auto-refill is on for this week.</p>
              <button className="primary" disabled={!!preview} onClick={() => fillTargets(weekStart)}>
                Fill targets & tasks
              </button>
              <button className="link small" onClick={() => setTemplatesOpen(true)}>
                Templates…
              </button>
            </>
          ) : (
            <>
              <b className="plan-title">Plan this week</b>
              <ol className="plan-steps">
                <li>
                  <button onClick={() => setTemplatesOpen(true)}>Apply a template…</button>
                </li>
                <li>Drag in this week's one-offs from the palette</li>
                <li>
                  <button className="primary" disabled={!!preview} onClick={() => fillTargets(weekStart)}>
                    Fill targets & tasks
                  </button>
                </li>
              </ol>
              <p className="hint small">Auto-refill and task scheduling start once targets are filled.</p>
            </>
          )}
          {preview && Object.keys(preview.plan.unplaceable).length > 0 && (
            <p className="warn small">Can't fit: {unplaceableText(preview.plan, categories)}</p>
          )}
        </div>
      )}
      {others.length > 0 && (
        <>
          <h4>Other time</h4>
          <ul className="others">
            {others.map((c) => (
              <li key={c.id}>
                <i className="swatch" style={{ background: (catMap.get(c.id) ?? c).colour }} />
                <span>{c.name}</span>
                <span className="num">{fmtHours(totals.get(c.id)!.scheduled)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="legend">
        <h4>Legend</h4>
        <div><ModeIcon mode="fixed" /> Fixed: never moved</div>
        <div><ModeIcon mode="flexible" /> Flexible: may be moved</div>
        <div><ModeIcon mode="target-fill" /> Target-fill: auto-placed</div>
        <div><ModeIcon mode="task" /> Task: click the box to tick off</div>
      </div>
    </aside>
  );
}
