import { useStore } from "./store";
import { expand } from "./recurrence";
import { addDays, dayIndex, fmtTime, MIN, startOfWeek, weekKey } from "./time";
import { invoke, notify, onTauriEvent } from "./platform";
import { isTauri } from "./db";
import type { Category, Occ } from "./types";
import { toICS } from "./ics";
import { MISSED_GRACE } from "./scheduler";

const TICK_MS = 30_000;
const SNOOZE_MIN = 5;

let lastReminder: { title: string; body: string } | null = null;
let lastTray = "";

function offsetFor(o: Occ, c: Category | undefined, defaultNotify: number): number | null {
  const v = o.notify === "default" ? (c?.notify ?? "default") : o.notify;
  if (v === "none") return null;
  return v === "default" ? defaultNotify : v;
}

/** Reminders: banner N minutes before each Weekplan event. */
function checkReminders(now: number) {
  const { events, categories, settings, saveSettings } = useStore.getState();
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const occs = expand(events, now - 60 * MIN, now + 24 * 60 * MIN);
  const sent = new Set(settings.notified);
  const fresh: string[] = [];
  for (const o of occs) {
    const off = offsetFor(o, catMap.get(o.categoryId), settings.defaultNotify);
    if (off === null || o.start <= now - MIN) continue;
    const fireAt = o.start - off * MIN;
    const key = `${o.occId}|${o.start}`;
    if (fireAt <= now && !sent.has(key)) {
      const mins = Math.max(0, Math.round((o.start - now) / MIN));
      const title = mins > 0 ? `${o.title} starts in ${mins} min` : `${o.title} is starting`;
      const body = `${fmtTime(o.start)} – ${fmtTime(o.end)}`;
      void notify(title, body);
      lastReminder = { title: `${o.title}: reminder`, body };
      fresh.push(key);
    }
  }
  if (fresh.length) {
    // keep the list short: drop keys for events that started over 2 days ago
    const cutoff = now - 2 * 24 * 60 * MIN;
    const kept = settings.notified.filter((k) => Number(k.split("|").pop()) > cutoff);
    saveSettings({ notified: [...kept, ...fresh] });
  }
}

/** End-of-block check-in for categories with check-in enabled (Research). */
function checkCheckIns(now: number) {
  const { events, categories, settings, saveSettings, setCheckIn, checkIn } = useStore.getState();
  if (checkIn) return;
  const enabled = new Set(categories.filter((c) => c.checkIn).map((c) => c.id));
  if (!enabled.size) return;
  const occs = expand(events, now - 30 * MIN, now + MIN);
  const due = occs.find(
    (o) => enabled.has(o.categoryId) && o.end <= now && o.end > now - 15 * MIN && !settings.checkedIn.includes(`${o.occId}|${o.end}`),
  );
  if (!due) return;
  const cutoff = now - 2 * 24 * 60 * MIN;
  saveSettings({ checkedIn: [...settings.checkedIn.filter((k) => Number(k.split("|").pop()) > cutoff), `${due.occId}|${due.end}`] });
  setCheckIn(due);
  void notify(`${due.title} block finished`, "Did you get through it? Open Weekplan to confirm or log an early finish.");
}

/** A task block that passed without a tick gets moved to the next suitable gap. */
function checkMissedTasks(now: number) {
  const { events, settings, refill } = useStore.getState();
  const week = startOfWeek(now);
  if (!settings.plannedWeeks.includes(weekKey(week))) return;
  const missed = events.some((e) => e.taskId && !e.done && e.start >= week && e.end <= now - MISSED_GRACE);
  if (missed) refill();
}

/** Menu bar: "Next: Gym 4pm". */
function updateTray(now: number) {
  const { events, categories } = useStore.getState();
  const muted = new Set(categories.filter((c) => c.muted).map((c) => c.id));
  const next = expand(events, now, now + 12 * 60 * MIN)
    .filter((o) => !muted.has(o.categoryId) && o.start >= now - MIN)
    .sort((a, b) => a.start - b.start)[0];
  const text = next ? `Next: ${next.title} ${fmtTime(next.start)}` : "";
  if (text !== lastTray) {
    lastTray = text;
    void invoke("set_tray_next", { text });
  }
}

/** Sunday-evening "Plan next week?" nudge. */
function checkPlanReminder(now: number) {
  const { settings, saveSettings } = useStore.getState();
  if (!settings.planReminder) return;
  const d = new Date(now);
  if (dayIndex(now) !== 6 || d.getHours() < 18) return;
  const next = weekKey(addDays(startOfWeek(now), 7));
  const key = `plan|${next}`;
  if (settings.plannedWeeks.includes(next) || settings.notified.includes(key)) return;
  saveSettings({ notified: [...settings.notified, key] });
  void notify("Plan next week?", "Apply your recurring events, drag in one-offs and fill targets.");
}

/** Daily JSON backup into the chosen (OneDrive) folder, newest 30 kept. */
async function checkBackup(now: number) {
  if (!isTauri) return;
  const { settings, saveSettings, showToast } = useStore.getState();
  let dir = settings.backupDir;
  if (!dir) {
    dir = await invoke<string | null>("default_backup_dir");
    if (!dir) return;
    saveSettings({ backupDir: dir });
  }
  const last = settings.lastBackup;
  if (last && new Date(last).toDateString() === new Date(now).toDateString()) return;
  await runBackup(dir).catch((e) => showToast(`Backup failed: ${e}`));
}

export async function runBackup(dir: string): Promise<string | null> {
  const { exportSnapshot, saveSettings } = useStore.getState();
  const d = new Date();
  const stamp = `${weekKey(d.getTime())}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  const contents = JSON.stringify({ app: "weekplan", version: 1, exportedAt: d.toISOString(), ...exportSnapshot() }, null, 1);
  const path = await invoke<string>("write_backup", { dir, stamp, contents });
  saveSettings({ lastBackup: Date.now() });
  return path;
}

export function exportICS(from: number, to: number): string {
  const { events, categories } = useStore.getState();
  return toICS(expand(events, from, to), categories);
}

export function startServices(): () => void {
  const run = () => {
    const now = Date.now();
    useStore.getState().tick(now);
    checkReminders(now);
    checkCheckIns(now);
    checkMissedTasks(now);
    updateTray(now);
    checkPlanReminder(now);
    void checkBackup(now);
  };
  run();
  const timer = setInterval(run, TICK_MS);
  let unlisten: (() => void) | null = null;
  void onTauriEvent("snooze-last", () => {
    const r = lastReminder;
    if (!r) return;
    setTimeout(() => void notify(r.title, r.body), SNOOZE_MIN * MIN);
  }).then((u) => (unlisten = u));
  return () => {
    clearInterval(timer);
    unlisten?.();
  };
}
