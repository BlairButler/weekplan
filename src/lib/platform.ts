import { isTauri } from "./db";

/** Thin wrappers so the UI also runs in a plain browser (for previewing). */

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

let permission: boolean | null = null;

export async function notify(title: string, body: string): Promise<void> {
  if (isTauri) {
    const n = await import("@tauri-apps/plugin-notification");
    if (permission === null) {
      permission = await n.isPermissionGranted();
      if (!permission) permission = (await n.requestPermission()) === "granted";
    }
    if (permission) n.sendNotification({ title, body });
    return;
  }
  if (typeof Notification !== "undefined") {
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission === "granted") new Notification(title, { body });
  }
}

export async function onTauriEvent(name: string, fn: () => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen(name, fn);
}

export async function saveFile(defaultName: string, contents: string, ext: string): Promise<string | null> {
  if (!isTauri) {
    const blob = new Blob([contents], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(a.href);
    return defaultName;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (!path) return null;
  await invoke("write_text_file", { path, contents });
  return path;
}

export async function openTextFile(ext: string): Promise<string | null> {
  if (!isTauri) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = `.${ext}`;
      input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
      input.click();
    });
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ multiple: false, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (!path || Array.isArray(path)) return null;
  return invoke<string>("read_text_file", { path });
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({ directory: true, multiple: false });
  return typeof path === "string" ? path : null;
}

export async function autostart(enable?: boolean): Promise<boolean | null> {
  if (!isTauri) return null;
  const a = await import("@tauri-apps/plugin-autostart");
  if (enable === true) await a.enable();
  if (enable === false) await a.disable();
  return a.isEnabled();
}
