import { useMemo } from "react";
import { useStore } from "../lib/store";
import { FALLBACK_CATEGORY, useCategoryMap, useOccurrences } from "../lib/selectors";
import { weekTotals } from "../lib/targets";
import { addDays, DAY_SHORT, fmtHours, startOfDay, startOfMonth, startOfWeek } from "../lib/time";

export function MonthView() {
  const anchor = useStore((s) => s.anchor);
  const now = useStore((s) => s.now);
  const categories = useStore((s) => s.categories);
  const { setAnchor, setView } = useStore.getState();
  const catMap = useCategoryMap();
  const month = new Date(startOfMonth(anchor)).getMonth();
  const gridStart = startOfWeek(startOfMonth(anchor));
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(gridStart, i * 7)).filter(
    (w, i) => i < 5 || new Date(w).getMonth() === month,
  );
  const gridEnd = addDays(weeks[weeks.length - 1], 7);
  const occs = useOccurrences(gridStart, gridEnd, false);
  const targets = categories.filter((c) => c.targetHours);
  const today = startOfDay(now);

  const weekSummaries = useMemo(() => weeks.map((w) => weekTotals(occs.filter((o) => o.end > w && o.start < addDays(w, 7)), w, now)), [occs, now, weeks.join()]);

  const open = (day: number) => {
    setAnchor(day);
    setView("week");
  };

  return (
    <div className="month">
      <div className="month-head">
        {DAY_SHORT.map((d) => (
          <div key={d}>{d}</div>
        ))}
        <div>Targets</div>
      </div>
      <div className="month-grid" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((w, wi) => (
          <div className="month-week" key={w}>
            {Array.from({ length: 7 }, (_, di) => {
              const day = addDays(w, di);
              const dayEnd = addDays(day, 1);
              const items = occs
                .filter((o) => o.start >= day && o.start < dayEnd && !(catMap.get(o.categoryId)?.muted ?? false))
                .sort((a, b) => a.start - b.start);
              return (
                <button
                  key={day}
                  className={`month-day ${new Date(day).getMonth() !== month ? "is-other" : ""} ${day === today ? "is-today" : ""}`}
                  onClick={() => open(day)}
                >
                  <span className="month-date">{new Date(day).getDate()}</span>
                  {items.slice(0, 4).map((o) => {
                    const c = catMap.get(o.categoryId) ?? FALLBACK_CATEGORY;
                    return (
                      <span key={o.occId} className={`month-item mode-${o.mode}`} style={{ ["--c" as string]: c.colour }}>
                        {o.title}
                      </span>
                    );
                  })}
                  {items.length > 4 && <span className="month-more">+{items.length - 4} more</span>}
                </button>
              );
            })}
            <div className="month-summary">
              {targets.map((c) => {
                const t = weekSummaries[wi].get(c.id)?.scheduled ?? 0;
                const target = (c.targetHours ?? 0) * 60;
                return (
                  <div key={c.id} className={t >= target ? "ok" : "short"} style={{ ["--c" as string]: c.colour }}>
                    <i className="swatch" style={{ background: c.colour }} />
                    {c.name} {fmtHours(t)}/{fmtHours(target)}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
