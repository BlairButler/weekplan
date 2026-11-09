# Weekplan

Mac weekly planner with drag-and-drop bubbles, colour-coded categories, weekly hour targets and auto-rescheduling. Design: [SPEC.md](SPEC.md).

## Run

```bash
npm install
npm run app:dev      # desktop app with hot reload
npm run app:build    # release build → src-tauri/target/release/bundle/macos/Weekplan.app (+ .dmg)
npm test             # scheduler / targets unit tests
npm run dev          # UI only in a browser at http://localhost:1420 (data in localStorage)
```

Requires Node and Rust (`brew install node rustup && rustup default stable`). The npm scripts add Homebrew's rustup to `PATH` themselves.

## Where things live

- `src/lib/scheduler.ts`: target-fill placement, trimming surplus, and the "move flexible blocks" preview
- `src/lib/targets.ts`: weekly totals (each 15-min slot counted once; most recently placed event wins)
- `src/lib/recurrence.ts`: weekly recurring events (e.g. Sleep)
- `src/lib/store.ts`: state, undo/redo, and the hybrid auto-refill after each edit
- `src/lib/services.ts`: reminders, Research check-in, menu bar text, Sunday plan reminder, daily backups
- `src-tauri/src/lib.rs`: menu bar (tray), hide-on-close, file and backup commands
- Data: SQLite `weekplan.db` in `~/Library/Application Support/com.weekplan.app/`

## Keyboard

←/→ previous/next week or month · T today · W week · M month · N new event · ⌘Z / ⇧⌘Z undo/redo · Esc dismiss preview/editor
