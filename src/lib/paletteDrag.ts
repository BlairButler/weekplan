import { create } from "zustand";
import type { Preset } from "./types";

/**
 * Pointer-based palette dragging. HTML5 drag-and-drop is intercepted by the
 * Tauri webview (native file drops), so the palette uses pointer events instead,
 * the same mechanism the bubbles use (and touch-friendly for a future Android build).
 */
interface PaletteDragState {
  drag: { preset: Preset; x: number; y: number; moved: boolean } | null;
}

export const usePaletteDrag = create<PaletteDragState>(() => ({ drag: null }));

type DropHandler = (preset: Preset, x: number, y: number) => boolean;
const dropHandlers = new Set<DropHandler>();

export function onPaletteDrop(fn: DropHandler): () => void {
  dropHandlers.add(fn);
  return () => dropHandlers.delete(fn);
}

export function startPaletteDrag(e: React.PointerEvent, preset: Preset) {
  if (e.button !== 0) return;
  e.preventDefault();
  const ox = e.clientX;
  const oy = e.clientY;
  usePaletteDrag.setState({ drag: { preset, x: ox, y: oy, moved: false } });
  document.body.classList.add("is-palette-dragging");

  const onMove = (ev: PointerEvent) => {
    const cur = usePaletteDrag.getState().drag;
    if (!cur) return;
    const moved = cur.moved || Math.abs(ev.clientX - ox) + Math.abs(ev.clientY - oy) > 4;
    usePaletteDrag.setState({ drag: { ...cur, x: ev.clientX, y: ev.clientY, moved } });
  };
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.classList.remove("is-palette-dragging");
    const cur = usePaletteDrag.getState().drag;
    usePaletteDrag.setState({ drag: null });
    if (!cur?.moved) return;
    for (const h of dropHandlers) if (h(preset, ev.clientX, ev.clientY)) break;
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
