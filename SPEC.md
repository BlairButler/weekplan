# Weekplan — Design Spec

A Mac-first weekly planner with drag-and-drop event "bubbles", colour-coded categories, weekly hour targets, and an auto-rescheduler that refills missed target time into open slots.

Status: **design agreed, not yet built.** (Spec date: 2026-11-09)

---

## 1. Platform & architecture

| Decision | Choice |
|---|---|
| Platform | macOS desktop app (Android deferred, may come later) |
| Stack | **Tauri** + web front end (React + TypeScript) |
| Storage | Local **SQLite** in the app support folder |
| Sync | None for now; data model designed so cloud sync can be added later |
| Background | Lives in the **menu bar** when window closed; launches at login; menu bar shows "Next: …" |
| Outlook | **Deferred.** Manual entry for now. Events carry a `source` field so import from the user's 3 Outlook accounts (ICS or Graph) can be added later, along with local hide rules (hide occurrence / series / keyword) |

## 2. Core data model

### Category
- `name`, `colour` (from ~16-colour light/dark-safe palette, or custom)
- `default_mode`: Fixed | Flexible
- `location`: Home | Uni | Gym | Travelling | **Neutral**
- `weekly_target_hours` (optional; no caps)
- `placement_rules` (editable, see §4)
- `notification_offset` (override of global 15-min default; may be "none")
- `blocking` (bool, whether it counts as busy time; default true)

**Initial categories**

| Category | Mode | Location | Target | Notes |
|---|---|---|---|---|
| Research | Flexible | Neutral | **30 h/wk** | Weekends allowed; end-of-block check-in on |
| Gym | Flexible | Gym | **8 h/wk** | Always 2 h blocks (min = max = 2 h) |
| Teaching | Fixed | Uni | – | |
| Marking | Fixed | Neutral | – | |
| Meetings | Fixed | Uni | – | |
| Lectures | Fixed | Uni | – | |
| Sleep | Fixed | Home | – | Muted band, not a bright block |
| Transport | Fixed | Travelling | – | Manual bubbles; not counted toward any work target |
| Hobbies (Rock Climbing, Rovers, Procreate, …) | Fixed | varies | optional | Any category may have a target, useful for hobbies |

### Event
- `title`, `category_id`, `start`, `end` (30-min granularity)
- `mode`: **Fixed** 🔒 | **Flexible** 🔄 | **Target-fill** (auto-generated, dashed outline). Default from category, per-event override
- `recurrence` (RRULE-style), `template_id` (if stamped from a template)
- `source`: manual | template | target-fill | (future) outlook:<account>
- `notification_offset` override
- One category per event; split into adjacent bubbles if needed

### Task (phase 2, but modelled now)
- `title`, `duration`, `windows` (inferred "home" or a named context), `due` (optional), `recurrence` (e.g. weekly, 3×/week)
- `can_do_while_travelling` (lets the placer put it inside a Transport block, e.g. a Star Trek episode on the train)
- `done` checkbox

### Week template
- Named set of events (e.g. "Semester week", "Break week") stamped into a week on demand. Unlimited templates.

### Palette preset
- A pre-configured bubble (e.g. "Commute 1.5 h", "Gym 2 h", "Research 4 h") for drag-to-add.

## 3. Recurring defaults

- **Sleep:** 10 PM–6 AM on Sun–Thu nights; midnight–8 AM on **Fri and Sat nights**.
- **Commute preset:** 1.5 h each way.

## 4. Rescheduler

### Placement rules (per category, all editable)
- Allowed windows (days and times)
- Min / max block length
- Max hours per day
- Buffer around blocks
- Preference: earliest available | spread evenly

Global: **30-min snap**; **protected time** windows the app never fills.

### Behaviour
- **Done is automatic:** past time counts as done. Resizing a block after the fact (e.g. 4 h research cut to 2 h) recalculates.
- **Shortfall handling (hybrid):**
  - Target-fill blocks are **auto-placed into empty time** (with an Undo toast).
  - If meeting the target needs **moving your existing flexible blocks**, it shows a **ghost preview** to accept or adjust.
  - Fixed events are never moved.
  - It never creates overlaps and never breaks rules. If it can't fit everything, it reports "Research: 3 h unplaceable this week".
- **Auto-rescheduling applies only within the current week.** Future weeks can be planned but aren't auto-adjusted.
- Targets **reset every Monday**; weekly history is kept for Stats.
- **Research check-in:** at the end of a research block, a banner asks "Finished? / Stopped early…". Stopping early sets the real end time and triggers a refill.

### Overlaps
- Allowed, shown side by side (Outlook-style); a subtle red edge when two **blocking** events collide.
- **Each minute counts toward at most one target** (top/most-recent event wins).

### Home inference (for tasks)
- "Home" = time not covered by sleep or an away-located event (Uni, Gym, Travelling). Neutral categories (Research, Marking) don't change location.
- Named contexts (e.g. "Weekend daytime") as a fallback.

## 5. Planning flow

1. Open a week → "Apply template?" (or none). Recurring events are already present.
2. Drag one-offs in from the palette.
3. **"Fill targets"** → preview of target-fill blocks → accept or tweak.
4. During the week: the hybrid auto-reschedule keeps targets on track.
- Optional **Sunday-evening notification:** "Plan next week?"
- Any future week can be planned ahead.

## 6. Views & UI

- **Week view (primary):** Monday start; 6 AM–midnight visible, scroll for sleep hours. Left sidebar: bubble palette (+ tasks inbox in phase 2). Right/top: target progress bars ("scheduled" vs "done" shaded). Drag to move, drag edges to resize, right-click for mode/category/delete. "Now" line, past events faded.
- **Month view:** overview with coloured bars per day; click → that week. Each week row has a target summary (Research 27/30).
- **Stats:** weekly target history over time.
- **Day view:** optional, low priority.
- **Look:** follows macOS light/dark; clean, Fantastical-style rounded bubbles with a strong left edge in the category colour; colours consistent across bubbles and progress bars. Default palette auto-assigned, changeable.
- **Shortcuts:** ←/→ weeks, T today, W/M views, N new event, ⌘Z/⇧⌘Z undo/redo (including auto-placements).

## 7. Notifications

- Native macOS banners, **15 min before** by default; per-category and per-event overrides.
- Click opens the event; **snooze** action.
- Only Weekplan's own events notify (relevant once Outlook import exists).

## 8. Data safety

- **Daily automatic backup to a OneDrive folder**, last 30 days kept.
- JSON export/import (full data; also the path to a future Android version).
- `.ics` export of a week or range.

---

## Build phases

**Phase 1: core planner**
1. Tauri + React scaffold, SQLite schema (including Task/template/source fields)
2. Categories (colours, modes, locations, targets, rules) + settings UI
3. Week view with drag/drop/resize, 30-min snap, overlaps
4. Bubble palette (presets)
5. Recurring events (sleep etc.)
6. Target progress tracking (done vs scheduled, no double counting)
7. Rescheduler: Fill targets + hybrid auto-refill + ghost preview + unplaceable report
8. Notifications, menu bar, launch at login, snooze, Research check-in
9. Month view, Stats/history
10. Undo/redo, keyboard shortcuts, OneDrive backups, JSON/.ics export

**Phase 2: planning power-ups**
- ✅ Week templates (built): save a week's hand-placed events (recurring, target-fill and task blocks excluded; untick one-offs), apply to any week (re-applying replaces that template's earlier copies; undoable), manage in Settings → Templates; right panel shows the "Plan this week" steps for unplanned weeks; Sunday reminder already in place
- ✅ Tasks/checklist (built): home inference (away from first to last Uni/Gym/Transport event each day), home hours cap (default 7:00–21:30), "anywhere" or specific-time windows, once (optional due) or N×/week, can-do-while-travelling (prefers commute slots), tick off from the list or the block, missed blocks (1 h after their slot) move to the next gap, unfinished one-offs carry to next week, targets get priority over tasks

**Later / deferred**
- Outlook import (3 accounts) with hide rules and keyword → category mapping
- Android (PWA or Tauri mobile) + cloud sync
- Day view
