import { useEffect } from "react";
import { useStore, type View } from "./lib/store";
import { addDays, addMonths, fmtWeekRange, startOfDay, startOfWeek, uid, MIN } from "./lib/time";
import { startServices } from "./lib/services";
import { WeekView } from "./components/WeekView";
import { MonthView } from "./components/MonthView";
import { StatsView } from "./components/StatsView";
import { SettingsView } from "./components/SettingsView";
import { Palette, TargetsPanel } from "./components/Sidebars";
import { EventEditor } from "./components/EventEditor";
import { CheckInDialog, PreviewBar, ToastView } from "./components/Overlays";
import { TemplatesDialog } from "./components/Templates";

const VIEWS: { id: View; label: string; key: string }[] = [
  { id: "week", label: "Week", key: "W" },
  { id: "month", label: "Month", key: "M" },
  { id: "stats", label: "Stats", key: "" },
  { id: "settings", label: "Settings", key: "" },
];

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const anchor = useStore((s) => s.anchor);
  const undoCount = useStore((s) => s.undoStack.length);
  const redoCount = useStore((s) => s.redoStack.length);
  const { init, setView, setAnchor, undo, redo, openEditor } = useStore.getState();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!ready) return;
    return startServices();
  }, [ready]);

  const step = (dir: number) => setAnchor(view === "month" ? addMonths(anchor, dir) : addDays(anchor, 7 * dir));

  const newEvent = () => {
    const start = startOfDay(Date.now()) + (new Date().getHours() + 1) * 60 * MIN;
    const cat = useStore.getState().categories.find((c) => c.id === "research") ?? useStore.getState().categories[0];
    openEditor({
      occ: null,
      draft: {
        id: uid(),
        title: cat?.name ?? "Event",
        categoryId: cat?.id ?? "",
        start,
        end: start + 60 * MIN,
        mode: cat?.defaultMode ?? "fixed",
        source: "manual",
        recurrence: null,
        exdates: [],
        notify: "default",
        notes: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      const s = useStore.getState();
      if (e.metaKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || s.editor || s.templatesOpen) return;
      if (e.key === "Escape" && s.preview) s.discardPreview();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "t" || e.key === "T") setAnchor(Date.now());
      else if (e.key === "w" || e.key === "W") setView("week");
      else if (e.key === "m" || e.key === "M") setView("month");
      else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        newEvent();
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!ready) return <div className="loading">Loading Weekplan…</div>;

  const title =
    view === "month"
      ? new Date(anchor).toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : fmtWeekRange(startOfWeek(anchor));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Weekplan</div>
        {(view === "week" || view === "month") && (
          <div className="nav">
            <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous" title="Previous (←)">
              ‹
            </button>
            <button onClick={() => setAnchor(Date.now())} title="Today (T)">
              Today
            </button>
            <button className="icon-btn" onClick={() => step(1)} aria-label="Next" title="Next (→)">
              ›
            </button>
            <h1>{title}</h1>
          </div>
        )}
        <span className="spacer" />
        <button className="icon-btn" disabled={!undoCount} onClick={undo} title="Undo (⌘Z)" aria-label="Undo">
          ↶
        </button>
        <button className="icon-btn" disabled={!redoCount} onClick={redo} title="Redo (⇧⌘Z)" aria-label="Redo">
          ↷
        </button>
        <button onClick={newEvent} title="New event (N)">
          + New
        </button>
        <div className="seg">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? "is-on" : ""} onClick={() => setView(v.id)} title={v.key ? `${v.label} (${v.key})` : v.label}>
              {v.label}
            </button>
          ))}
        </div>
      </header>
      <main className={`main view-${view}`}>
        {view === "week" && (
          <>
            <Palette />
            <WeekView />
            <TargetsPanel />
          </>
        )}
        {view === "month" && <MonthView />}
        {view === "stats" && <StatsView />}
        {view === "settings" && <SettingsView />}
      </main>
      <PreviewBar />
      <ToastView />
      <EventEditor />
      <CheckInDialog />
      <TemplatesDialog />
    </div>
  );
}
