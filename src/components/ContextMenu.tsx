import { useEffect, useRef, useState } from "react";
import { stripOcc, useStore } from "../lib/store";
import type { Mode, Occ } from "../lib/types";
import { ModeIcon, MODE_LABEL } from "./icons";

export interface MenuState {
  x: number;
  y: number;
  occ: Occ;
}

export function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const categories = useStore((s) => s.categories);
  const { updateOcc, deleteOcc, openEditor, addEvent } = useStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<"mode" | "category" | null>(null);
  const { occ } = state;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const act = (fn: () => void) => {
    fn();
    onClose();
  };

  const left = Math.min(state.x, window.innerWidth - 220);
  const top = Math.min(state.y, window.innerHeight - 260);

  return (
    <div className="menu" ref={ref} style={{ left, top }}>
      {occ.taskId && (
        <button onClick={() => act(() => useStore.getState().setTaskBlockDone(occ, !occ.done))}>
          <ModeIcon mode="task" done={!occ.done} /> {occ.done ? "Mark not done" : "Mark done"}
        </button>
      )}
      <button onClick={() => act(() => openEditor({ draft: { ...stripOcc(occ) }, occ }))}>Edit…</button>
      <button onClick={() => setSub(sub === "mode" ? null : "mode")}>Mode ›</button>
      {sub === "mode" &&
        (["fixed", "flexible", "target-fill"] as Mode[]).filter(() => !occ.taskId).map((m) => (
          <button key={m} className={`sub ${occ.mode === m ? "is-on" : ""}`} onClick={() => act(() => updateOcc(occ, { mode: m }, "series"))}>
            <ModeIcon mode={m} /> {MODE_LABEL[m]}
          </button>
        ))}
      <button onClick={() => setSub(sub === "category" ? null : "category")}>Category ›</button>
      {sub === "category" &&
        categories.map((c) => (
          <button
            key={c.id}
            className={`sub ${occ.categoryId === c.id ? "is-on" : ""}`}
            onClick={() => act(() => updateOcc(occ, { categoryId: c.id }, "series"))}
          >
            <i className="swatch" style={{ background: c.colour }} /> {c.name}
          </button>
        ))}
      <button
        onClick={() =>
          act(() => {
            const now = Date.now();
            addEvent({ ...stripOcc(occ), id: crypto.randomUUID(), recurrence: null, exdates: [], createdAt: now, updatedAt: now, start: occ.end, end: occ.end + (occ.end - occ.start) });
          })
        }
      >
        Duplicate after
      </button>
      <hr />
      <button className="danger" onClick={() => act(() => deleteOcc(occ, "this"))}>
        {occ.recurring ? "Delete this occurrence" : "Delete"}
      </button>
      {occ.recurring && (
        <button className="danger" onClick={() => act(() => deleteOcc(occ, "series"))}>
          Delete whole series
        </button>
      )}
    </div>
  );
}
