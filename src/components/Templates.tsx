import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { FALLBACK_CATEGORY, useCategoryMap, useOccurrences } from "../lib/selectors";
import { templateAppliedIn, templateCandidates, toTemplateItems } from "../lib/templates";
import { addDays, DAY_SHORT, fmtHours, fmtMinutesOfDay, fmtTime, fmtWeekRange, startOfWeek, uid } from "../lib/time";
import type { TemplateItem, WeekTemplate } from "../lib/types";

export function itemSummary(items: TemplateItem[]): string {
  const names = [...new Set(items.map((i) => i.title))];
  return names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4} more` : "");
}

export function TemplatesDialog() {
  const open = useStore((s) => s.templatesOpen);
  const anchor = useStore((s) => s.anchor);
  const templates = useStore((s) => s.templates);
  const events = useStore((s) => s.events);
  const { setTemplatesOpen, applyTemplate, saveTemplate } = useStore.getState();
  const catMap = useCategoryMap();
  const weekStart = startOfWeek(anchor);
  const occs = useOccurrences(weekStart, addDays(weekStart, 7), false);
  const candidates = useMemo(() => templateCandidates(occs, weekStart), [occs, weekStart]);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [overwrite, setOverwrite] = useState("");

  if (!open) return null;
  const close = () => {
    setTemplatesOpen(false);
    setUnticked(new Set());
    setName("");
    setOverwrite("");
  };
  const chosen = candidates.filter((o) => !unticked.has(o.occId));
  const sorted = [...templates].sort((a, b) => a.order - b.order);

  const save = () => {
    const items = toTemplateItems(chosen);
    if (overwrite) {
      const t = templates.find((x) => x.id === overwrite)!;
      saveTemplate({ ...t, items });
    } else {
      saveTemplate({ id: uid(), name: name.trim() || `Week of ${fmtWeekRange(weekStart)}`, items, order: Date.now(), createdAt: Date.now() });
    }
    close();
    useStore.getState().showToast(overwrite ? "Template updated" : "Template saved");
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()}>
        <h2>Week templates</h2>
        <p className="hint">For the week of {fmtWeekRange(weekStart)}</p>

        <h3>Apply to this week</h3>
        {sorted.length === 0 ? (
          <p className="hint">No templates yet. Set up a typical week, then save it below.</p>
        ) : (
          <ul className="tpl-list">
            {sorted.map((t) => {
              const applied = templateAppliedIn(events, t.id, weekStart);
              return (
                <li key={t.id}>
                  <div>
                    <b>{t.name}</b>
                    <span className="hint">
                      {t.items.length} event{t.items.length === 1 ? "" : "s"} · {itemSummary(t.items)}
                    </span>
                  </div>
                  <button
                    className={applied ? "" : "primary"}
                    title={applied ? "Removes this template's events from the week and stamps them again" : ""}
                    onClick={() => {
                      applyTemplate(t.id, weekStart);
                      close();
                    }}
                  >
                    {applied ? "Re-apply (replaces)" : "Apply"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <h3>Save this week as a template</h3>
        {candidates.length === 0 ? (
          <p className="hint">
            Nothing to save: add the week's fixed things (lectures, teaching, commutes…) first. Recurring events, target-fill blocks and
            tasks are left out because they're generated anyway.
          </p>
        ) : (
          <>
            <p className="hint">Untick anything that's a one-off. Recurring events, target-fill blocks and tasks aren't included.</p>
            <ul className="tpl-pick">
              {candidates.map((o) => {
                const c = catMap.get(o.categoryId) ?? FALLBACK_CATEGORY;
                return (
                  <li key={o.occId}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!unticked.has(o.occId)}
                        onChange={() => {
                          const n = new Set(unticked);
                          if (n.has(o.occId)) n.delete(o.occId);
                          else n.add(o.occId);
                          setUnticked(n);
                        }}
                      />
                      <i className="swatch" style={{ background: c.colour }} />
                      <span className="tpl-day">{DAY_SHORT[(new Date(o.start).getDay() + 6) % 7]}</span>
                      <span className="tpl-time">
                        {fmtTime(o.start)}–{fmtTime(o.end)}
                      </span>
                      <span>{o.title}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="row align-end">
              {overwrite ? null : (
                <label className="grow">
                  Template name
                  <input placeholder="e.g. Semester week" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
              )}
              {sorted.length > 0 && (
                <label>
                  Save as
                  <select value={overwrite} onChange={(e) => setOverwrite(e.target.value)}>
                    <option value="">New template</option>
                    {sorted.map((t) => (
                      <option key={t.id} value={t.id}>
                        Replace "{t.name}"
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button className="primary" disabled={!chosen.length} onClick={save}>
                Save ({chosen.length})
              </button>
            </div>
          </>
        )}
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** Settings → Templates: rename, prune items, delete. */
export function TemplateSettings() {
  const templates = useStore((s) => s.templates);
  const { saveTemplate, deleteTemplate, setTemplatesOpen, setView } = useStore.getState();
  const catMap = useCategoryMap();
  const sorted = [...templates].sort((a, b) => a.order - b.order);
  return (
    <section>
      <p className="hint">
        Templates are saved from a real week: set the week up, then use <b>Templates…</b> in the week view's right panel.
      </p>
      {sorted.length === 0 && (
        <button
          onClick={() => {
            setView("week");
            setTemplatesOpen(true);
          }}
        >
          Open week templates
        </button>
      )}
      {sorted.map((t) => (
        <TemplateCard key={t.id} tpl={t} onSave={saveTemplate} onDelete={() => deleteTemplate(t.id)} catColour={(id) => (catMap.get(id) ?? FALLBACK_CATEGORY).colour} />
      ))}
    </section>
  );
}

function TemplateCard({ tpl, onSave, onDelete, catColour }: { tpl: WeekTemplate; onSave: (t: WeekTemplate) => void; onDelete: () => void; catColour: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  const items = [...tpl.items].sort((a, b) => a.day - b.day || a.start - b.start);
  return (
    <div className={`card ${open ? "is-open" : ""}`} style={{ ["--c" as string]: "var(--accent)" }}>
      <button className="card-head" onClick={() => setOpen(!open)}>
        <b>{tpl.name}</b>
        <span className="muted">
          {tpl.items.length} event{tpl.items.length === 1 ? "" : "s"}
        </span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="card-body">
          <label className="row">
            <input value={tpl.name} onChange={(e) => onSave({ ...tpl, name: e.target.value })} aria-label="Template name" />
          </label>
          <ul className="tpl-pick">
            {items.map((it, i) => (
              <li key={i}>
                <span className="check">
                  <i className="swatch" style={{ background: catColour(it.categoryId) }} />
                  <span className="tpl-day">{DAY_SHORT[it.day]}</span>
                  <span className="tpl-time">
                    {fmtMinutesOfDay(it.start)} · {fmtHours(it.duration)}
                  </span>
                  <span>{it.title}</span>
                  <button className="icon-btn" aria-label="Remove from template" onClick={() => onSave({ ...tpl, items: tpl.items.filter((x) => x !== it) })}>
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="card-actions">
            <button className="danger" onClick={onDelete}>
              Delete template
            </button>
            <span className="hint">Events already stamped into weeks stay put.</span>
          </div>
        </div>
      )}
    </div>
  );
}
