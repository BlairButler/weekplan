import { useMemo } from "react";
import { useStore } from "./store";
import { expand } from "./recurrence";
import type { Category, Occ } from "./types";

/** Occurrences in [from, to), including preview ghosts when a preview is showing. */
export function useOccurrences(from: number, to: number, withPreview = true): Occ[] {
  const events = useStore((s) => s.events);
  const preview = useStore((s) => s.preview);
  return useMemo(() => {
    const occs = expand(events, from, to);
    if (!withPreview || !preview) return occs;
    const ghosts: Occ[] = [];
    for (const a of preview.plan.add) {
      if (a.end > from && a.start < to) {
        ghosts.push({ ...a, occId: `ghost:${a.id}`, baseId: a.id, origStart: a.start, recurring: false, ghost: "new" });
      }
    }
    for (const [id, m] of Object.entries(preview.plan.moves)) {
      const ev = events.find((e) => e.id === id);
      if (ev && m.end > from && m.start < to) {
        ghosts.push({ ...ev, ...m, occId: `ghost:${id}`, baseId: id, origStart: ev.start, recurring: false, ghost: "moved" });
      }
    }
    return [...occs, ...ghosts];
  }, [events, preview, from, to, withPreview]);
}

export function useCategoryMap(): Map<string, Category> {
  const categories = useStore((s) => s.categories);
  return useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
}

export const FALLBACK_CATEGORY: Category = {
  id: "unknown",
  name: "Uncategorised",
  colour: "#64748b",
  defaultMode: "fixed",
  location: "neutral",
  targetHours: null,
  rules: { windows: [], minBlock: 60, maxBlock: 120, maxPerDay: 240, buffer: 0, preference: "spread" },
  notify: "default",
  checkIn: false,
  blocking: true,
  muted: false,
  order: 999,
};
