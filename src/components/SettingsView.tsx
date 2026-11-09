import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { PALETTE, defaultRules } from "../lib/defaults";
import { DAY_SHORT, fmtMinutesOfDay, fmtWeekRange, addDays, parseHHMM, startOfWeek, uid } from "../lib/time";
import type { Category, Place, TimeWindow } from "../lib/types";
import { autostart, openTextFile, pickFolder, saveFile } from "../lib/platform";
import { exportICS, runBackup } from "../lib/services";
import { isTauri, type Snapshot } from "../lib/db";
import { TemplateSettings } from "./Templates";

type Tab = "categories" | "palette" | "templates" | "general" | "data";

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("categories");
  return (
    <div className="settings">
      <nav className="tabs">
        {(["categories", "palette", "templates", "general", "data"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>
            {t === "data" ? "Data & backups" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {tab === "categories" && <Categories />}
        {tab === "palette" && <PaletteSettings />}
        {tab === "templates" && <TemplateSettings />}
        {tab === "general" && <General />}
        {tab === "data" && <Data />}
      </div>
    </div>
  );
}

function Categories() {
  const categories = useStore((s) => s.categories);
  const { saveCategory } = useStore.getState();
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  return (
    <section>
      <p className="hint">
        Every event belongs to one category. A weekly target makes the rescheduler keep that many hours in your week, following
        the placement rules.
      </p>
      {sorted.map((c) => (
        <CategoryCard key={c.id} cat={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
      ))}
      <button
        onClick={() => {
          const id = uid();
          saveCategory({
            id,
            name: "New category",
            colour: PALETTE[categories.length % PALETTE.length],
            defaultMode: "fixed",
            location: "neutral",
            targetHours: null,
            rules: defaultRules(),
            notify: "default",
            checkIn: false,
            blocking: true,
            muted: false,
            order: categories.length,
          });
          setOpen(id);
        }}
      >
        + Add category
      </button>
    </section>
  );
}

function CategoryCard({ cat, open, onToggle }: { cat: Category; open: boolean; onToggle: () => void }) {
  const { saveCategory, deleteCategory } = useStore.getState();
  const events = useStore((s) => s.events);
  const [c, setC] = useState(cat);
  useEffect(() => setC(cat), [cat]);
  const set = (patch: Partial<Category>) => {
    const next = { ...c, ...patch };
    setC(next);
    saveCategory(next);
  };
  const setRules = (patch: Partial<Category["rules"]>) => set({ rules: { ...c.rules, ...patch } });
  const inUse = events.some((e) => e.categoryId === c.id);

  return (
    <div className={`card ${open ? "is-open" : ""}`} style={{ ["--c" as string]: c.colour }}>
      <button className="card-head" onClick={onToggle}>
        <i className="swatch" style={{ background: c.colour }} />
        <b>{c.name}</b>
        <span className="muted">
          {c.defaultMode === "flexible" ? "Flexible" : "Fixed"}
          {c.targetHours ? ` · ${c.targetHours}h/week target` : ""}
        </span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="card-body">
          <div className="row">
            <label>
              Name
              <input value={c.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label>
              Weekly target (hours)
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="none"
                value={c.targetHours ?? ""}
                onChange={(e) => set({ targetHours: e.target.value === "" || Number(e.target.value) === 0 ? null : Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="colours">
            {PALETTE.map((p) => (
              <button key={p} className={`colour ${c.colour === p ? "is-on" : ""}`} style={{ background: p }} onClick={() => set({ colour: p })} aria-label={p} />
            ))}
            <input type="color" value={c.colour} onChange={(e) => set({ colour: e.target.value })} />
          </div>
          <div className="row">
            <label>
              Default mode
              <select value={c.defaultMode} onChange={(e) => set({ defaultMode: e.target.value as Category["defaultMode"] })}>
                <option value="fixed">Fixed (never moved)</option>
                <option value="flexible">Flexible (may be moved)</option>
              </select>
            </label>
            <label>
              Location
              <select value={c.location} onChange={(e) => set({ location: e.target.value as Place })}>
                <option value="neutral">Neutral (anywhere)</option>
                <option value="home">Home</option>
                <option value="uni">Uni</option>
                <option value="gym">Gym</option>
                <option value="travelling">Travelling</option>
              </select>
            </label>
            <label>
              Reminder
              <select
                value={typeof c.notify === "number" ? "custom" : c.notify}
                onChange={(e) => set({ notify: e.target.value === "custom" ? 15 : (e.target.value as "default" | "none") })}
              >
                <option value="default">Global default</option>
                <option value="none">None</option>
                <option value="custom">Custom…</option>
              </select>
            </label>
            {typeof c.notify === "number" && (
              <label>
                Minutes before
                <input type="number" min={0} step={5} value={c.notify} onChange={(e) => set({ notify: Number(e.target.value) })} />
              </label>
            )}
          </div>
          <div className="checks">
            <label className="check">
              <input type="checkbox" checked={c.blocking} onChange={(e) => set({ blocking: e.target.checked })} />
              Blocks time (rescheduler won't place things over it)
            </label>
            <label className="check">
              <input type="checkbox" checked={c.muted} onChange={(e) => set({ muted: e.target.checked })} />
              Show as a muted background band (like Sleep)
            </label>
            <label className="check">
              <input type="checkbox" checked={c.checkIn} onChange={(e) => set({ checkIn: e.target.checked })} />
              End-of-block check-in ("Finished? / Stopped early")
            </label>
          </div>

          {c.targetHours ? (
            <fieldset>
              <legend>Placement rules (used when auto-placing {c.name})</legend>
              <WindowsEditor windows={c.rules.windows} onChange={(windows) => setRules({ windows })} />
              <div className="row">
                <label>
                  Min block (min)
                  <input type="number" min={30} step={30} value={c.rules.minBlock} onChange={(e) => setRules({ minBlock: Number(e.target.value) })} />
                </label>
                <label>
                  Max block (min)
                  <input type="number" min={30} step={30} value={c.rules.maxBlock} onChange={(e) => setRules({ maxBlock: Number(e.target.value) })} />
                </label>
                <label>
                  Max per day (min)
                  <input type="number" min={30} step={30} value={c.rules.maxPerDay} onChange={(e) => setRules({ maxPerDay: Number(e.target.value) })} />
                </label>
                <label>
                  Buffer around (min)
                  <input type="number" min={0} step={5} value={c.rules.buffer} onChange={(e) => setRules({ buffer: Number(e.target.value) })} />
                </label>
                <label>
                  Preference
                  <select value={c.rules.preference} onChange={(e) => setRules({ preference: e.target.value as "earliest" | "spread" })}>
                    <option value="earliest">Earliest available</option>
                    <option value="spread">Spread across the week</option>
                  </select>
                </label>
              </div>
            </fieldset>
          ) : null}

          <div className="card-actions">
            <button
              className="danger"
              disabled={inUse}
              title={inUse ? "Events still use this category" : ""}
              onClick={() => deleteCategory(c.id)}
            >
              Delete category
            </button>
            {inUse && <span className="hint">In use by events, so it can't be deleted.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function WindowsEditor({ windows, onChange }: { windows: TimeWindow[]; onChange: (w: TimeWindow[]) => void }) {
  const update = (i: number, patch: Partial<TimeWindow>) => onChange(windows.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  return (
    <div className="windows">
      {windows.map((w, i) => (
        <div key={i} className="window-row">
          <div className="days">
            {DAY_SHORT.map((n, d) => (
              <button
                type="button"
                key={n}
                className={w.days.includes(d) ? "is-on" : ""}
                onClick={() => update(i, { days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d].sort() })}
              >
                {n}
              </button>
            ))}
          </div>
          <input type="time" step={1800} value={fmtMinutesOfDay(w.start)} onChange={(e) => update(i, { start: parseHHMM(e.target.value) })} />
          <span>to</span>
          <input
            type="time"
            step={1800}
            value={fmtMinutesOfDay(w.end % 1440)}
            onChange={(e) => update(i, { end: parseHHMM(e.target.value) || 1440 })}
          />
          <button type="button" className="icon-btn" onClick={() => onChange(windows.filter((_, j) => j !== i))} aria-label="Remove window">
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...windows, { days: [0, 1, 2, 3, 4], start: 9 * 60, end: 17 * 60 }])}>
        + Add time window
      </button>
    </div>
  );
}

function PaletteSettings() {
  const presets = useStore((s) => s.presets);
  const categories = useStore((s) => s.categories);
  const { savePreset, deletePreset } = useStore.getState();
  const sorted = [...presets].sort((a, b) => a.order - b.order);
  return (
    <section>
      <p className="hint">Preset bubbles in the left sidebar. Drag one onto the week to add it.</p>
      <table className="preset-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Category</th>
            <th>Duration (min)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr key={p.id}>
              <td>
                <input value={p.title} onChange={(e) => savePreset({ ...p, title: e.target.value })} />
              </td>
              <td>
                <select value={p.categoryId} onChange={(e) => savePreset({ ...p, categoryId: e.target.value })}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="number" min={30} step={30} value={p.duration} onChange={(e) => savePreset({ ...p, duration: Number(e.target.value) })} />
              </td>
              <td className="nowrap">
                <button className="icon-btn" disabled={i === 0} onClick={() => swap(sorted, i, i - 1, savePreset)} aria-label="Move up">
                  ↑
                </button>
                <button className="icon-btn" disabled={i === sorted.length - 1} onClick={() => swap(sorted, i, i + 1, savePreset)} aria-label="Move down">
                  ↓
                </button>
                <button className="icon-btn" onClick={() => deletePreset(p.id)} aria-label="Delete">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => savePreset({ id: uid(), title: "New preset", categoryId: categories[0]?.id ?? "", duration: 60, order: presets.length })}>
        + Add preset
      </button>
    </section>
  );
}

function swap<T extends { order: number }>(list: T[], a: number, b: number, save: (x: T) => void) {
  save({ ...list[a], order: list[b].order });
  save({ ...list[b], order: list[a].order });
}

function General() {
  const settings = useStore((s) => s.settings);
  const { saveSettings } = useStore.getState();
  const [login, setLogin] = useState<boolean | null>(null);
  useEffect(() => {
    void autostart().then(setLogin);
  }, []);
  return (
    <section>
      <div className="row">
        <label>
          Default reminder (minutes before)
          <input type="number" min={0} step={5} value={settings.defaultNotify} onChange={(e) => saveSettings({ defaultNotify: Number(e.target.value) })} />
        </label>
      </div>
      <div className="checks">
        <label className="check">
          <input type="checkbox" checked={settings.planReminder} onChange={(e) => saveSettings({ planReminder: e.target.checked })} />
          Sunday 6pm reminder: "Plan next week?"
        </label>
        <label className="check">
          <input
            type="checkbox"
            disabled={login === null}
            checked={!!login}
            onChange={async (e) => setLogin(await autostart(e.target.checked))}
          />
          Launch Weekplan at login (starts in the menu bar) {login === null && <span className="hint">(desktop app only)</span>}
        </label>
      </div>
      <fieldset>
        <legend>Home hours (tasks are only placed between these times)</legend>
        <div className="row align-end">
          <label>
            From
            <input
              type="time"
              step={1800}
              value={fmtMinutesOfDay(settings.homeHours.start)}
              onChange={(e) => saveSettings({ homeHours: { ...settings.homeHours, start: parseHHMM(e.target.value) } })}
            />
          </label>
          <label>
            Until
            <input
              type="time"
              step={1800}
              value={fmtMinutesOfDay(settings.homeHours.end % 1440)}
              onChange={(e) => saveSettings({ homeHours: { ...settings.homeHours, end: parseHHMM(e.target.value) || 1440 } })}
            />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Protected time (the rescheduler never fills these)</legend>
        <WindowsEditor windows={settings.protectedWindows} onChange={(protectedWindows) => saveSettings({ protectedWindows })} />
      </fieldset>
    </section>
  );
}

function Data() {
  const settings = useStore((s) => s.settings);
  const anchor = useStore((s) => s.anchor);
  const { saveSettings, exportSnapshot, importSnapshot, showToast } = useStore.getState();
  const [busy, setBusy] = useState(false);
  const weekStart = startOfWeek(anchor);

  return (
    <section>
      <h3>Automatic backups</h3>
      <p className="hint">A daily JSON backup is written to this folder (the newest 30 are kept).</p>
      <div className="row align-end">
        <label className="grow">
          Backup folder
          <input readOnly value={settings.backupDir ?? (isTauri ? "Detecting OneDrive…" : "Desktop app only")} />
        </label>
        <button disabled={!isTauri} onClick={async () => { const d = await pickFolder(); if (d) saveSettings({ backupDir: d }); }}>
          Choose…
        </button>
        <button
          className="primary"
          disabled={!isTauri || !settings.backupDir || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const p = await runBackup(settings.backupDir!);
              showToast(`Backed up to ${p}`);
            } catch (e) {
              showToast(`Backup failed: ${e}`);
            }
            setBusy(false);
          }}
        >
          Back up now
        </button>
      </div>
      <p className="hint">Last backup: {settings.lastBackup ? new Date(settings.lastBackup).toLocaleString() : "never"}</p>

      <h3>Export & import</h3>
      <div className="row">
        <button
          onClick={async () => {
            const json = JSON.stringify({ app: "weekplan", version: 1, exportedAt: new Date().toISOString(), ...exportSnapshot() }, null, 1);
            const p = await saveFile("weekplan-export.json", json, "json");
            if (p) showToast("Exported");
          }}
        >
          Export everything (JSON)
        </button>
        <button
          onClick={async () => {
            const text = await openTextFile("json");
            if (!text) return;
            try {
              const data = JSON.parse(text) as Snapshot & { app?: string };
              if (data.app !== "weekplan" || !Array.isArray(data.events)) throw new Error("Not a Weekplan export");
              if (!confirm("Replace ALL current Weekplan data with this file?")) return;
              await importSnapshot(data);
              showToast("Imported");
            } catch (e) {
              showToast(`Import failed: ${e instanceof Error ? e.message : e}`);
            }
          }}
        >
          Import JSON…
        </button>
        <button
          onClick={async () => {
            const ics = exportICS(weekStart, addDays(weekStart, 7));
            const p = await saveFile(`weekplan-${fmtWeekRange(weekStart).replace(/[^\w]+/g, "-")}.ics`, ics, "ics");
            if (p) showToast("Exported .ics");
          }}
        >
          Export this week (.ics)
        </button>
      </div>
    </section>
  );
}
