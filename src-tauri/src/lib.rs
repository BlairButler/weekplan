use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

struct TrayState {
    next_item: MenuItem<tauri::Wry>,
}

const MAX_BACKUPS: usize = 30;

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Updates the menu bar title ("Next: Gym 4:00") and the first tray menu row.
#[tauri::command]
fn set_tray_next(app: AppHandle, text: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let title = if text.is_empty() { None } else { Some(text.clone()) };
        tray.set_title(title).map_err(|e| e.to_string())?;
    }
    if let Some(state) = app.try_state::<Mutex<TrayState>>() {
        let s = state.lock().map_err(|e| e.to_string())?;
        let label = if text.is_empty() { "Nothing coming up".to_string() } else { text };
        s.next_item.set_text(label).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Suggests ~/Library/CloudStorage/OneDrive*/Weekplan Backups if OneDrive is installed.
#[tauri::command]
fn default_backup_dir() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let cloud = PathBuf::from(home).join("Library/CloudStorage");
    let entry = fs::read_dir(&cloud)
        .ok()?
        .filter_map(|e| e.ok())
        .find(|e| e.file_name().to_string_lossy().starts_with("OneDrive"))?;
    Some(entry.path().join("Weekplan Backups").to_string_lossy().to_string())
}

/// Writes weekplan-backup-<stamp>.json into `dir`, keeping only the newest 30.
#[tauri::command]
fn write_backup(dir: String, stamp: String, contents: String) -> Result<String, String> {
    let dir = PathBuf::from(dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("weekplan-backup-{stamp}.json"));
    fs::write(&path, contents).map_err(|e| e.to_string())?;

    let mut backups: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .map(|n| {
                    let n = n.to_string_lossy();
                    n.starts_with("weekplan-backup-") && n.ends_with(".json")
                })
                .unwrap_or(false)
        })
        .collect();
    backups.sort();
    if backups.len() > MAX_BACKUPS {
        for old in &backups[..backups.len() - MAX_BACKUPS] {
            let _ = fs::remove_file(old);
        }
    }
    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .invoke_handler(tauri::generate_handler![
            set_tray_next,
            write_text_file,
            read_text_file,
            default_backup_dir,
            write_backup
        ])
        .setup(|app| {
            let next_item = MenuItem::with_id(app, "next", "Nothing coming up", false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open Weekplan", true, None::<&str>)?;
            let snooze = MenuItem::with_id(app, "snooze", "Snooze last reminder (5 min)", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Weekplan", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&next_item, &sep1, &open, &snooze, &sep2, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("Weekplan")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "snooze" => {
                        let _ = app.emit("snooze-last", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            app.manage(Mutex::new(TrayState { next_item }));

            // Launched at login with --hidden: start in the menu bar only.
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it so reminders keep firing from the menu bar.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Weekplan");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            show_main(app);
        }
        let _ = (app, event);
    });
}
