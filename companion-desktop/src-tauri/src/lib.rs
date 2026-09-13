//! Mission Mate desktop shell.
//!
//! The window UI (ui/) is intentionally thin. All log watching + pushing is the
//! existing compiled companion, shipped here as a Tauri **sidecar** and driven
//! from Rust: `connect` hands the pasted session to the sidecar's `login`, then
//! spawns it in watch mode and streams its stdout/stderr back to the window.
//! Nothing from the CLI is re-implemented.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// Publishable client creds (safe to ship; RLS enforces per-user access). Passed
// to the sidecar via env so `login` only needs to store the session.
const SUPABASE_URL: &str = "https://ubysptfxmnpafakwnxyu.supabase.co";
const SUPABASE_ANON_KEY: &str = "sb_publishable_WINIYHhIeUDIQgrbAA2RpA_xDfeV4TA";

#[derive(Default)]
struct AppState {
    /// The running watch process, if any.
    child: Mutex<Option<CommandChild>>,
}

#[derive(Clone, serde::Serialize)]
struct StatusPayload {
    state: String,
    text: String,
}

fn emit_status(app: &AppHandle, state: &str, text: &str) {
    let _ = app.emit(
        "mm-status",
        StatusPayload {
            state: state.to_string(),
            text: text.to_string(),
        },
    );
}

fn emit_log(app: &AppHandle, line: impl Into<String>) {
    let _ = app.emit("mm-log", line.into());
}

/// Store the pasted session (via the sidecar's tolerant `login`), then start watching.
#[tauri::command]
async fn connect(app: AppHandle, token: String) -> Result<(), String> {
    let mut token_path = std::env::temp_dir();
    token_path.push("mission-mate-token.json");
    std::fs::write(&token_path, token.as_bytes()).map_err(|e| e.to_string())?;

    let login = app
        .shell()
        .sidecar("mission-mate")
        .map_err(|e| e.to_string())?
        .args(["login", "--file", &token_path.to_string_lossy()]);
    let out = login.output().await.map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&token_path);

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "Sign-in failed — check the value you pasted.".to_string()
        } else {
            err
        });
    }
    emit_log(&app, "Signed in.");

    start_watch(&app)
}

/// Spawn the companion in watch mode and stream its output to the window.
fn start_watch(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.child.lock().unwrap().is_some() {
        return Ok(()); // already running
    }

    let (mut rx, child) = app
        .shell()
        .sidecar("mission-mate")
        .map_err(|e| e.to_string())?
        .env("SUPABASE_URL", SUPABASE_URL)
        .env("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY)
        .spawn()
        .map_err(|e| e.to_string())?;

    *state.child.lock().unwrap() = Some(child);
    emit_status(app, "watching", "Watching Game.log");

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    emit_log(&app, String::from_utf8_lossy(&bytes).trim_end().to_string());
                }
                CommandEvent::Terminated(payload) => {
                    app.state::<AppState>().child.lock().unwrap().take();
                    emit_status(&app, "idle", "Stopped");
                    emit_log(&app, format!("Companion exited (code {:?}).", payload.code));
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// What the sidecar currently knows about the Game.log, for the window's
/// "Game.log" row. Mirrors `mission-mate print-config --json`.
#[derive(Clone, serde::Serialize, serde::Deserialize, Default)]
struct LogStatus {
    #[serde(rename = "configPath")]
    config_path: Option<String>,
    /// Path the player chose by hand, if any.
    #[serde(rename = "savedLogPath")]
    saved_log_path: Option<String>,
    /// What the companion would actually watch right now (auto-found or saved).
    #[serde(rename = "resolvedLogPath")]
    resolved_log_path: Option<String>,
}

/// Ask the sidecar where the log is. Never fails the UI — an unreadable answer
/// just means "unknown", and the window shows the picker either way.
#[tauri::command]
async fn log_status(app: AppHandle) -> LogStatus {
    let Ok(cmd) = app.shell().sidecar("mission-mate") else {
        return LogStatus::default();
    };
    let Ok(out) = cmd.args(["print-config", "--json"]).output().await else {
        return LogStatus::default();
    };
    serde_json::from_slice(&out.stdout).unwrap_or_default()
}

/// Open a native file picker, hand the choice to the sidecar's `set-log`, and
/// restart the watcher so the new path takes effect immediately.
///
/// This is the whole reason the plugin is here: players were being told to
/// hand-edit config.json, which is not a reasonable ask.
#[tauri::command]
async fn choose_log_file(app: AppHandle) -> Result<LogStatus, String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .set_title("Select your Star Citizen Game.log")
        .add_filter("Game log", &["log"])
        // try_send, not blocking_send: this callback runs on the UI thread and
        // the channel has room for the single value we ever put in it.
        .pick_file(move |picked| {
            let _ = tx.try_send(picked);
        });

    let Some(Some(picked)) = rx.recv().await else {
        return Ok(log_status(app).await); // cancelled — nothing changed
    };
    let path = picked.to_string();

    let out = app
        .shell()
        .sidecar("mission-mate")
        .map_err(|e| e.to_string())?
        .args(["set-log", &path])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("Could not use that file: {path}")
        } else {
            err
        });
    }

    emit_log(&app, format!("Game.log set to {path}"));
    restart_watch(&app);
    Ok(log_status(app).await)
}

/// Forget the chosen path and go back to searching the usual install folders.
#[tauri::command]
async fn clear_log_file(app: AppHandle) -> Result<LogStatus, String> {
    let out = app
        .shell()
        .sidecar("mission-mate")
        .map_err(|e| e.to_string())?
        .args(["set-log", "--clear"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    emit_log(&app, "Back to finding Game.log automatically.");
    restart_watch(&app);
    Ok(log_status(app).await)
}

/// Bounce the watcher if it is running, so a path change is picked up without
/// the player having to press Stop then Connect.
fn restart_watch(app: &AppHandle) {
    if app.state::<AppState>().child.lock().unwrap().is_none() {
        return; // not watching — nothing to pick the new path up for
    }
    stop(app.clone());
    let _ = start_watch(app);
}

#[tauri::command]
fn stop(app: AppHandle) {
    if let Some(child) = app.state::<AppState>().child.lock().unwrap().take() {
        let _ = child.kill();
    }
    emit_status(&app, "idle", "Stopped");
}

#[tauri::command]
fn open_site() {
    let _ = open::that("https://sc-haulerhelper.com");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            connect,
            stop,
            open_site,
            log_status,
            choose_log_file,
            clear_log_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mission Mate");
}
