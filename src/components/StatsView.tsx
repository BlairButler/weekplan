import { useMemo } from "react";
import { useStore } from "../lib/store";
import { expand } from "../lib/recurrence";
import { weekTotals } from "../lib/targets";
import { addDays, fmtHours, fmtWeekRange, startOfWeek, weekKey } from "../lib/time";

const WEEKS = 12;

export function StatsView() {
  const events = useStore((s) => s.events);
  const categories = useStore((s) => s.categories);
  const settings = useStore((s) => s.settings);
  const now = useStore((s) => s.now);
  const { setAnchor, setView } = useStore.getState();

  const thisWeek = startOfWeek(now);
  const weeks = useMemo(() => Array.from({ length: WEEKS }, (_, i) => addDays(thisWeek, -7 * i)), [thisWeek]);
  const rows = useMemo(
    () =>
      weeks.map((w) => {
        const occs = expand(events, w, addDays(w, 7));
        return { week: w, totals: weekTotals(occs, w, now), targets: settings.weekTargets[weekKey(w)] };
      }),
    [weeks, events, now, settings.weekTargets],
  );

  const tracked = categories.filter((c) => c.targetHours || rows.some((r) => r.targets?.[c.id]));

  return (
    <div className="stats">
      <h2>Weekly history</h2>
      <p className="hint">
        Done hours against each week's target (targets are recorded as each week begins). The current week shows progress so far.
      </p>
      {tracked.length === 0 && <p>No categories have weekly targets yet. Add one in Settings.</p>}
      <table>
        <thead>
          <tr>
            <th>Week</th>
            {tracked.map((c) => (
              <th key={c.id}>
                <i className="swatch" style={{ background: c.colour }} /> {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.week}>
              <td>
                <button
                  className="link"
                  onClick={() => {
                    setAnchor(r.week);
                    setView("week");
                  }}
                >
                  {fmtWeekRange(r.week)}
                </button>
                {r.week === thisWeek && <span className="pill">now</span>}
              </td>
              {tracked.map((c) => {
                const target = (r.targets?.[c.id] ?? (r.week === thisWeek ? c.targetHours : null) ?? 0) * 60;
                const done = r.totals.get(c.id)?.done ?? 0;
                const pct = target ? Math.min(100, (done / target) * 100) : 0;
                return (
                  <td key={c.id}>
                    <div className="stat-cell" style={{ ["--c" as string]: c.colour }}>
                      <div className="bar">
                        <div className="bar-done" style={{ width: `${pct}%` }} />
                      </div>
                      <span className={target && done >= target ? "ok" : ""}>
                        {fmtHours(done)}
                        {target ? ` / ${fmtHours(target)}` : ""}
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
