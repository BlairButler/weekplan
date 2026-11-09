import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { stripOcc, useStore } from "../lib/store";
import { FALLBACK_CATEGORY, useCategoryMap, useOccurrences } from "../lib/selectors";
import { layoutColumns } from "../lib/layout";
import { addDays, atMinutes, DAY_SHORT, fmtHours, fmtTime, MIN, SNAP, startOfDay, startOfWeek, uid } from "../lib/time";
import type { CalEvent, Category, Occ, Preset } from "../lib/types";
import { onPaletteDrop, usePaletteDrag } from "../lib/paletteDrag";
import { ModeIcon } from "./icons";
import { ContextMenu, type MenuState } from "./ContextMenu";

const VISIBLE_START = 6; // 6am
const VISIBLE_HOURS = 18; // 6am–midnight
const GUTTER = 56;

type DragKind = "move" | "resize-end" | "resize-start" | "create";
interface Drag {
  kind: DragKind;
  occ: Occ | null;
  originX: number;
  originY: number;
  grabOffset: number; // minutes between block start and pointer
  anchor: number; // create: instant where the drag began
  start: number;
  end: number;
  moved: boolean;
}

export function WeekView() {
  const anchor = useStore((s) => s.anchor);
  const now = useStore((s) => s.now);
  const preview = useStore((s) => s.preview);
  const { updateOcc, addEvent, openEditor, movePreviewItem } = useStore.getState();
  const catMap = useCategoryMap();
  const weekStart = startOfWeek(anchor);
  const weekEnd = addDays(weekStart, 7);
  const occs = useOccurrences(weekStart, weekEnd);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [hourH, setHourH] = useState(44);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const dragRef = useRef<Drag | null>(null);

  // Fit 6am–midnight in the viewport; sleep hours are reachable by scrolling.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fit = () => setHourH(Math.max(32, Math.floor(el.clientHeight / VISIBLE_HOURS)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = VISIBLE_START * hourH;
  }, [hourH, weekStart]);

  const cat = (id: string): Category => catMap.get(id) ?? FALLBACK_CATEGORY;

  /** Pointer position → (day index, snapped instant). */
  const pointToTime = (clientX: number, clientY: number, offsetMin = 0) => {
    const rect = bodyRef.current!.getBoundingClientRect();
    const colW = (rect.width - GUTTER) / 7;
    const day = Math.min(6, Math.max(0, Math.floor((clientX - rect.left - GUTTER) / colW)));
    const raw = ((clientY - rect.top) / hourH) * 60 - offsetMin;
    const minutes = Math.min(24 * 60, Math.max(0, Math.round(raw / SNAP) * SNAP));
    return { day, t: atMinutes(addDays(weekStart, day), minutes) };
  };

  const beginDrag = (e: React.PointerEvent, kind: DragKind, occ: Occ | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const at = pointToTime(e.clientX, e.clientY);
    const initial: Drag = {
      kind,
      occ,
      originX: e.clientX,
      originY: e.clientY,
      grabOffset: occ ? Math.round((at.t - occ.start) / MIN / SNAP) * SNAP : 0,
      anchor: at.t,
      start: occ ? occ.start : at.t,
      end: occ ? occ.end : at.t + SNAP * MIN,
      moved: false,
    };
    dragRef.current = initial;
    setDrag(initial);

    // Listeners are attached synchronously so even very quick drags are captured.
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current!;
      const moved = d.moved || Math.abs(ev.clientX - d.originX) + Math.abs(ev.clientY - d.originY) > 4;
      let { start, end } = d;
      if (d.kind === "move" && d.occ) {
        const dur = d.occ.end - d.occ.start;
        start = pointToTime(ev.clientX, ev.clientY, d.grabOffset).t;
        end = start + dur;
      } else if (d.kind === "resize-end" && d.occ) {
        // relative to where the drag began, so Option-dragging from the middle doesn't jump
        end = Math.max(d.occ.start + SNAP * MIN, d.occ.end + (pointToTime(ev.clientX, ev.clientY).t - d.anchor));
      } else if (d.kind === "resize-start" && d.occ) {
        start = Math.min(d.occ.end - SNAP * MIN, d.occ.start + (pointToTime(ev.clientX, ev.clientY).t - d.anchor));
      } else if (d.kind === "create") {
        const t = pointToTime(ev.clientX, ev.clientY).t;
        start = Math.min(d.anchor, t);
        end = Math.max(d.anchor + SNAP * MIN, t);
      }
      dragRef.current = { ...d, start, end, moved };
      setDrag(dragRef.current);
    };
    const onUp = (ev: PointerEvent) => {
      onMove(ev);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const d = dragRef.current!;
      dragRef.current = null;
      setDrag(null);
      if (d.kind === "create") {
        const start = d.moved ? d.start : d.anchor;
        const end = d.moved ? d.end : d.anchor + 60 * MIN;
        openEditor({ draft: newDraft(start, end), occ: null });
        return;
      }
      if (!d.occ) return;
      if (!d.moved) {
        if (!d.occ.ghost) openEditor({ draft: { ...stripOcc(d.occ) }, occ: d.occ });
        return;
      }
      if (d.start === d.occ.start && d.end === d.occ.end) return;
      if (d.occ.ghost) movePreviewItem(d.occ.baseId, d.start, d.end);
      else updateOcc(d.occ, { start: d.start, end: d.end });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const newDraft = (start: number, end: number, categoryId = "research", title = ""): CalEvent => {
    const c = cat(categoryId);
    return {
      id: uid(),
      title: title || c.name,
      categoryId: c.id,
      start,
      end,
      mode: c.defaultMode,
      source: "manual",
      recurrence: null,
      exdates: [],
      notify: "default",
      notes: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  };

  // Palette drops (pointer-based; see lib/paletteDrag.ts).
  const paletteDrag = usePaletteDrag((st) => st.drag);
  const insideBody = (x: number, y: number) => {
    const el = scrollRef.current;
    const body = bodyRef.current;
    if (!el || !body) return false;
    const r = el.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    return x >= br.left + GUTTER && x <= br.right && y >= r.top && y <= r.bottom;
  };
  const dropHint =
    paletteDrag?.moved && insideBody(paletteDrag.x, paletteDrag.y)
      ? { ...pointToTime(paletteDrag.x, paletteDrag.y), dur: paletteDrag.preset.duration }
      : null;
  const dropRef = useRef<(p: Preset, x: number, y: number) => boolean>(() => false);
  dropRef.current = (p, x, y) => {
    if (!insideBody(x, y)) return false;
    const { t } = pointToTime(x, y);
    addEvent({ ...newDraft(t, t + p.duration * MIN, p.categoryId, p.title), source: "preset" });
    return true;
  };
  useEffect(() => onPaletteDrop((p, x, y) => dropRef.current(p, x, y)), []);

  // Apply in-flight drag to the rendered occurrences.
  const shown = useMemo(() => {
    let list = occs;
    if (drag?.occ && drag.moved) {
      list = list.map((o) => (o.occId === drag.occ!.occId ? { ...o, start: drag.start, end: drag.end } : o));
    }
    return list;
  }, [occs, drag]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = startOfDay(now);
  const movedIds = new Set(preview ? Object.keys(preview.plan.moves) : []);
  const removedIds = new Set(preview ? preview.plan.remove : []);

  return (
    <div className="week">
      <div className="week-head" style={{ gridTemplateColumns: `${GUTTER}px repeat(7, 1fr)` }}>
        <div />
        {days.map((d, i) => (
          <div key={d} className={`week-day-name ${d === today ? "is-today" : ""}`}>
            <span>{DAY_SHORT[i]}</span>
            <b>{new Date(d).getDate()}</b>
          </div>
        ))}
      </div>
      <div className="week-scroll" ref={scrollRef}>
        <div
          className="week-body"
          ref={bodyRef}
          style={{ height: hourH * 24, gridTemplateColumns: `${GUTTER}px repeat(7, 1fr)` }}
        >
          <div className="gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="gutter-label" style={{ top: h * hourH }}>
                {h === 0 ? "" : `${h}:00`}
              </div>
            ))}
          </div>
          {days.map((dayMs, di) => {
            const dayEnd = addDays(dayMs, 1);
            const segs = shown
              .filter((o) => o.end > dayMs && o.start < dayEnd)
              .map((o) => ({ o, start: Math.max(o.start, dayMs), end: Math.min(o.end, dayEnd) }));
            const bands = segs.filter((s) => cat(s.o.categoryId).muted && !s.o.ghost);
            const blocks = segs.filter((s) => !(cat(s.o.categoryId).muted && !s.o.ghost));
            const cols = layoutColumns(blocks.map((s) => ({ key: s.o.occId, start: s.start, end: s.end })));
            const blocking = segs.filter((s) => !s.o.ghost && cat(s.o.categoryId).blocking);
            const top = (t: number) => ((t - dayMs) / MIN / 60) * hourH;
            return (
              <div
                key={dayMs}
                className={`day-col ${dayMs === today ? "is-today" : ""}`}
                onPointerDown={(e) => beginDrag(e, "create", null)}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="hour-line" style={{ top: h * hourH }} />
                ))}
                {bands.map(({ o, start, end }) => (
                  <div
                    key={o.occId}
                    className="band"
                    style={{ top: top(start), height: top(end) - top(start), ["--c" as string]: cat(o.categoryId).colour }}
                    onPointerDown={(e) => beginDrag(e, "move", o)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, occ: o });
                    }}
                  >
                    {o.start >= dayMs && <span>{o.title}</span>}
                  </div>
                ))}
                {blocks.map(({ o, start, end }) => {
                  const c = cat(o.categoryId);
                  const pos = cols.get(o.occId)!;
                  const collides =
                    !o.ghost &&
                    c.blocking &&
                    blocking.some((b) => b.o.occId !== o.occId && b.start < end && b.end > start);
                  const h = top(end) - top(start);
                  // Task lengths come from the task; tiny blocks have no room for grips (Option-drag resizes them).
                  const canResize = !o.taskId && h >= 28;
                  const classes = [
                    "bubble",
                    `mode-${o.mode}`,
                    o.end <= now ? "is-past" : "",
                    o.ghost ? `ghost ghost-${o.ghost}` : "",
                    !o.ghost && (movedIds.has(o.baseId) || removedIds.has(o.baseId)) ? "is-superseded" : "",
                    collides ? "collides" : "",
                    drag?.occ?.occId === o.occId && drag.moved ? "is-dragging" : "",
                    h < 30 ? "is-short" : "",
                    o.done ? "is-done" : "",
                  ].join(" ");
                  return (
                    <div
                      key={o.occId}
                      className={classes}
                      style={{
                        top: top(start),
                        height: Math.max(h - 2, 16),
                        left: `calc(${(pos.col / pos.cols) * 100}% + 2px)`,
                        width: `calc(${100 / pos.cols}% - 4px)`,
                        ["--c" as string]: c.colour,
                      }}
                      onPointerDown={(e) => beginDrag(e, e.altKey && !o.taskId ? "resize-end" : "move", o)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!o.ghost) setMenu({ x: e.clientX, y: e.clientY, occ: o });
                      }}
                      title={`${o.title}\n${fmtTime(o.start)} – ${fmtTime(o.end)}\n${
                        o.taskId ? "Length comes from the task (edit it in Tasks)" : canResize ? "Drag the top or bottom edge to change the length" : "Option-drag to change the length"
                      }`}
                    >
                      {canResize && o.start >= dayMs && (
                        <div className="resize-handle top" onPointerDown={(e) => beginDrag(e, "resize-start", o)} />
                      )}
                      <div className="bubble-title">
                        {o.taskId && !o.ghost ? (
                          <span
                            className="task-check"
                            role="checkbox"
                            aria-checked={!!o.done}
                            title={o.done ? "Mark not done" : "Mark done"}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              useStore.getState().setTaskBlockDone(o, !o.done);
                            }}
                          >
                            <ModeIcon mode="task" done={!!o.done} />
                          </span>
                        ) : (
                          <ModeIcon mode={o.mode} />
                        )}
                        <span>{o.ghost === "new" ? `${o.title} (proposed)` : o.title}</span>
                      </div>
                      {h >= 34 && (
                        <div className="bubble-time">
                          {fmtTime(o.start)} – {fmtTime(o.end)}
                        </div>
                      )}
                      {canResize && o.end <= dayEnd && (
                        <div className="resize-handle bottom" onPointerDown={(e) => beginDrag(e, "resize-end", o)} />
                      )}
                    </div>
                  );
                })}
                {drag?.occ && drag.moved && drag.kind !== "create" && (() => {
                  // Live label so you can see the new time/length before letting go.
                  const anchorT = drag.kind === "resize-end" ? drag.end : drag.start;
                  if (anchorT < dayMs || anchorT > dayEnd) return null;
                  const y = drag.kind === "resize-end" ? top(drag.end) + 4 : Math.max(0, top(drag.start) - 24);
                  return (
                    <div className="drag-label" style={{ top: y }}>
                      {fmtTime(drag.start)} – {fmtTime(drag.end)} · {fmtHours((drag.end - drag.start) / MIN)}
                    </div>
                  );
                })()}
                {drag?.kind === "create" && drag.moved && drag.start < dayEnd && drag.end > dayMs && (
                  <div
                    className="create-hint"
                    style={{ top: top(Math.max(drag.start, dayMs)), height: top(Math.min(drag.end, dayEnd)) - top(Math.max(drag.start, dayMs)) }}
                  >
                    {fmtTime(drag.start)} – {fmtTime(drag.end)} · {fmtHours((drag.end - drag.start) / MIN)}
                  </div>
                )}
                {dropHint?.day === di && (
                  <div className="create-hint" style={{ top: top(dropHint.t), height: (dropHint.dur / 60) * hourH }}>
                    {paletteDrag?.preset.title} · {fmtTime(dropHint.t)}
                  </div>
                )}
                {dayMs === today && <div className="now-line" style={{ top: top(now) }} />}
              </div>
            );
          })}
        </div>
      </div>
      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
