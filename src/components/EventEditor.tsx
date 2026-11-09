import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { addDays, DAY_SHORT, fmtMinutesOfDay, minutesOfDay, parseHHMM, startOfDay } from "../lib/time";
import type { CalEvent, Mode, NotifySetting } from "../lib/types";
import { MODE_LABEL } from "./icons";

function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromDateInput(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function EventEditor() {
  const editor = useStore((s) => s.editor);
  const categories = useStore((s) => s.categories);
  const { openEditor, addEvent, updateOcc, deleteOcc, commitEvents } = useStore.getState();
  const [d, setD] = useState<CalEvent | null>(null);

  useEffect(() => setD(editor ? { ...editor.draft } : null), [editor]);
  if (!editor || !d) return null;
  const occ = editor.occ;
  const isNew = !occ;

  const day = startOfDay(d.start);
  const startMin = minutesOfDay(d.start);
  const durMin = Math.round((d.end - d.start) / 60000);
  const endMin = minutesOfDay(d.end);

  const set = (patch: Partial<CalEvent>) => setD({ ...d, ...patch });
  const setDay = (newDay: number) => {
    const start = new Date(newDay).setHours(0, startMin, 0, 0);
    set({ start, end: start + durMin * 60000 });
  };
  const setStart = (m: number) => {
    const start = new Date(day).setHours(0, m, 0, 0);
    set({ start, end: start + durMin * 60000 });
  };
  const setEnd = (m: number) => {
    let end = new Date(day).setHours(0, m, 0, 0);
    if (end <= d.start) end = addDays(end, 1); // crosses midnight
    set({ end });
  };
  const close = () => openEditor(null);

  const save = (scope: "this" | "series") => {
    const clean = { ...d, title: d.title.trim() || categories.find((c) => c.id === d.categoryId)?.name || "Event", updatedAt: Date.now() };
    if (isNew) addEvent(clean);
    else if (occ!.recurring && scope === "series") {
      const base = useStore.getState().events.find((e) => e.id === occ!.baseId)!;
      const shift = clean.start - occ!.start;
      const dur = clean.end - clean.start;
      const start = base.start + shift;
      commitEvents(
        useStore.getState().events.map((e) =>
          e.id === base.id ? { ...e, ...clean, id: base.id, exdates: base.exdates, start, end: start + dur } : e,
        ),
      );
    } else if (occ!.recurring) {
      updateOcc(occ!, { ...clean, recurrence: null }, "this"); // detach just this occurrence
    } else updateOcc(occ!, clean);
    close();
  };

  const notifyValue = d.notify === "default" ? "default" : d.notify === "none" ? "none" : "custom";
  const rec = d.recurrence;

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && close()}
        onSubmit={(e) => {
          e.preventDefault();
          save(occ?.recurring ? "this" : "series");
        }}
      >
        <h2>{isNew ? "New event" : "Edit event"}</h2>
        <label>
          Title
          <input autoFocus value={d.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <div className="row">
          <label>
            Category
            <select
              value={d.categoryId}
              onChange={(e) => {
                const c = categories.find((x) => x.id === e.target.value)!;
                const wasDefaultTitle = categories.some((x) => x.name === d.title) || !d.title;
                set({ categoryId: c.id, mode: isNew ? c.defaultMode : d.mode, title: wasDefaultTitle ? c.name : d.title });
              }}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mode
            <select value={d.mode} onChange={(e) => set({ mode: e.target.value as Mode })}>
              {(Object.keys(MODE_LABEL) as Mode[]).filter((m) => m !== "task" || d.mode === "task").map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label>
            Date
            <input type="date" value={toDateInput(d.start)} onChange={(e) => e.target.value && setDay(fromDateInput(e.target.value))} />
          </label>
          <label>
            Start
            <input type="time" step={1800} value={fmtMinutesOfDay(startMin)} onChange={(e) => setStart(parseHHMM(e.target.value))} />
          </label>
          <label>
            End
            <input
              type="time"
              step={1800}
              value={fmtMinutesOfDay(endMin)}
              onChange={(e) => setEnd(parseHHMM(e.target.value))}
            />
          </label>
        </div>
        <fieldset>
          <legend>Repeat</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={!!rec}
              onChange={(e) => set({ recurrence: e.target.checked ? { days: [(new Date(d.start).getDay() + 6) % 7], until: null } : null })}
            />
            Weekly
          </label>
          {rec && (
            <>
              <div className="days">
                {DAY_SHORT.map((n, i) => (
                  <button
                    type="button"
                    key={n}
                    className={rec.days.includes(i) ? "is-on" : ""}
                    onClick={() =>
                      set({
                        recurrence: {
                          ...rec,
                          days: rec.days.includes(i) ? rec.days.filter((x) => x !== i) : [...rec.days, i].sort(),
                        },
                      })
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
              <label>
                Until (optional)
                <input
                  type="date"
                  value={rec.until ? toDateInput(rec.until) : ""}
                  onChange={(e) => set({ recurrence: { ...rec, until: e.target.value ? fromDateInput(e.target.value) + 86_399_000 : null } })}
                />
              </label>
            </>
          )}
        </fieldset>
        <div className="row">
          <label>
            Reminder
            <select
              value={notifyValue}
              onChange={(e) => {
                const v = e.target.value;
                set({ notify: (v === "custom" ? 15 : v) as NotifySetting });
              }}
            >
              <option value="default">Category default</option>
              <option value="none">None</option>
              <option value="custom">Custom…</option>
            </select>
          </label>
          {notifyValue === "custom" && (
            <label>
              Minutes before
              <input type="number" min={0} step={5} value={d.notify as number} onChange={(e) => set({ notify: Number(e.target.value) })} />
            </label>
          )}
        </div>
        <label>
          Notes
          <textarea rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        <div className="modal-actions">
          {!isNew && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                deleteOcc(occ!, "this");
                close();
              }}
            >
              {occ!.recurring ? "Delete occurrence" : "Delete"}
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={close}>
            Cancel
          </button>
          {occ?.recurring ? (
            <>
              <button type="submit">Save this one</button>
              <button type="button" className="primary" onClick={() => save("series")}>
                Save series
              </button>
            </>
          ) : (
            <button type="submit" className="primary">
              Save
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
