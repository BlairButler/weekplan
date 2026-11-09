import type { CalEvent, Category, Preset, Settings, Task, WeekTemplate } from "./types";

export type Table = "categories" | "events" | "presets" | "tasks" | "templates";

export interface Snapshot {
  categories: Category[];
  events: CalEvent[];
  presets: Preset[];
  tasks: Task[];
  templates: WeekTemplate[];
  settings: Partial<Settings> | null;
}

export interface Backend {
  load(): Promise<Snapshot>;
  upsert(table: Table, rows: { id: string }[]): Promise<void>;
  remove(table: Table, ids: string[]): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
  replaceAll(s: Snapshot): Promise<void>;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** SQLite via tauri-plugin-sql. Rows hold JSON so the model can evolve without migrations. */
async function sqliteBackend(): Promise<Backend> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const db = await Database.load("sqlite:weekplan.db");
  for (const t of ["categories", "presets", "tasks", "templates"]) {
    await db.execute(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  }
  await db.execute(
    "CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, start INTEGER NOT NULL, end INTEGER NOT NULL, data TEXT NOT NULL)",
  );
  await db.execute("CREATE INDEX IF NOT EXISTS events_time ON events(start, end)");
  await db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

  const rows = async <T>(t: Table) =>
    (await db.select<{ data: string }[]>(`SELECT data FROM ${t}`)).map((r) => JSON.parse(r.data) as T);

  const backend: Backend = {
    async load() {
      const s = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = 'settings'");
      return {
        categories: await rows<Category>("categories"),
        events: await rows<CalEvent>("events"),
        presets: await rows<Preset>("presets"),
        tasks: await rows<Task>("tasks"),
        templates: await rows<WeekTemplate>("templates"),
        settings: s.length ? JSON.parse(s[0].value) : null,
      };
    },
    async upsert(table, list) {
      for (const r of list) {
        if (table === "events") {
          const e = r as CalEvent;
          await db.execute(
            "INSERT INTO events (id, start, end, data) VALUES ($1, $2, $3, $4) ON CONFLICT(id) DO UPDATE SET start = $2, end = $3, data = $4",
            [e.id, e.start, e.end, JSON.stringify(e)],
          );
        } else {
          await db.execute(
            `INSERT INTO ${table} (id, data) VALUES ($1, $2) ON CONFLICT(id) DO UPDATE SET data = $2`,
            [r.id, JSON.stringify(r)],
          );
        }
      }
    },
    async remove(table, ids) {
      for (const id of ids) await db.execute(`DELETE FROM ${table} WHERE id = $1`, [id]);
    },
    async saveSettings(s) {
      await db.execute(
        "INSERT INTO settings (key, value) VALUES ('settings', $1) ON CONFLICT(key) DO UPDATE SET value = $1",
        [JSON.stringify(s)],
      );
    },
    async replaceAll(s) {
      for (const t of ["categories", "events", "presets", "tasks", "templates"]) await db.execute(`DELETE FROM ${t}`);
      await backend.upsert("categories", s.categories);
      await backend.upsert("events", s.events);
      await backend.upsert("presets", s.presets);
      await backend.upsert("tasks", s.tasks ?? []);
      await backend.upsert("templates", s.templates ?? []);
      if (s.settings) await backend.saveSettings(s.settings as Settings);
    },
  };
  return backend;
}

/** Browser fallback (vite dev without Tauri): localStorage. */
function localBackend(): Backend {
  const key = (t: string) => `weekplan:${t}`;
  const read = <T>(t: string): T[] => {
    try {
      return JSON.parse(localStorage.getItem(key(t)) ?? "[]");
    } catch {
      return [];
    }
  };
  const write = (t: string, v: unknown) => {
    try {
      localStorage.setItem(key(t), JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  };
  const backend: Backend = {
    async load() {
      let settings = null;
      try {
        settings = JSON.parse(localStorage.getItem(key("settings")) ?? "null");
      } catch {
        /* ignore */
      }
      return { categories: read("categories"), events: read("events"), presets: read("presets"), tasks: read("tasks"), templates: read("templates"), settings };
    },
    async upsert(t, list) {
      const map = new Map(read<{ id: string }>(t).map((r) => [r.id, r]));
      for (const r of list) map.set(r.id, r);
      write(t, [...map.values()]);
    },
    async remove(t, ids) {
      const drop = new Set(ids);
      write(t, read<{ id: string }>(t).filter((r) => !drop.has(r.id)));
    },
    async saveSettings(s) {
      write("settings", s);
    },
    async replaceAll(s) {
      write("categories", s.categories);
      write("events", s.events);
      write("presets", s.presets);
      write("tasks", s.tasks ?? []);
      write("templates", s.templates ?? []);
      write("settings", s.settings);
    },
  };
  return backend;
}

export async function openBackend(): Promise<Backend> {
  return isTauri ? sqliteBackend() : localBackend();
}
