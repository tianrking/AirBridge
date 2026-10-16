// Copyright (c) 2026 tianrking <10758833+tianrking@users.noreply.github.com>
mod model;
use airbridge_host::{actor::Actor, protocol};
use model::{SelectedFile, Snapshot};
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
struct Selection {
    file: SelectedFile,
    path: PathBuf,
}
struct AppState {
    actor: Mutex<Option<Actor>>,
    snapshot: Arc<Mutex<Snapshot>>,
    selected: Mutex<Option<Selection>>,
    receive_directory: Mutex<PathBuf>,
    diagnostics: Mutex<Option<std::fs::File>>,
}
fn locked<T>(value: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    value
        .lock()
        .map_err(|_| "Application state unavailable; restart AirBridge".into())
}
fn publish(app: &tauri::AppHandle, state: &Arc<Mutex<Snapshot>>, event: Value) {
    // Curated host events only: never serial chunks, file bodies or TLS keys.
    if event["event"] != "peers" {
        use std::io::Write;
        if let Some(app_state) = app.try_state::<AppState>() {
            if let Ok(mut destination) = app_state.diagnostics.lock() {
                if let Some(file) = destination.as_mut() {
                    if file
                        .metadata()
                        .is_ok_and(|value| value.len() < 8 * 1024 * 1024)
                    {
                        let _ = writeln!(
                            file,
                            "{}",
                            serde_json::json!({"time_ms":model::now(),"data":event})
                        );
                        let _ = file.flush();
                    }
                }
            }
        }
    }
    if let Ok(mut snapshot) = state.lock() {
        snapshot.apply(&event);
        let _ = app.emit("bridge-snapshot", snapshot.clone());
    }
}
#[tauri::command]
fn get_snapshot(state: State<AppState>) -> Result<Snapshot, String> {
    Ok(locked(&state.snapshot)?.clone())
}
#[tauri::command]
fn dismiss_error(app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    let mut snapshot = locked(&state.snapshot)?;
    snapshot.error = None;
    snapshot.revision += 1;
    app.emit("bridge-snapshot", snapshot.clone())
        .map_err(|error| error.to_string())
}
#[tauri::command]
async fn connect_bridge(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut actor = locked(&state.actor)?;
    if actor.as_ref().is_some_and(|actor| !actor.finished()) {
        return Err("Bridge is already connected or connecting".into());
    }
    actor.take();
    let directory = locked(&state.receive_directory)?.clone();
    let snapshot = state.snapshot.clone();
    let handle = app.clone();
    publish(&app, &snapshot, serde_json::json!({"event":"connecting"}));
    *actor = Some(
        Actor::start(
            directory,
            Arc::new(move |event| publish(&handle, &snapshot, event)),
        )
        .map_err(|e| e.to_string())?,
    );
    Ok(())
}
#[tauri::command]
async fn disconnect_bridge(state: State<'_, AppState>) -> Result<(), String> {
    let actor = locked(&state.actor)?.take();
    tauri::async_runtime::spawn_blocking(move || drop(actor))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn choose_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<SelectedFile>, String> {
    let file =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_file())
            .await
            .map_err(|e| e.to_string())?;
    let Some(file) = file else { return Ok(None) };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Filename must be UTF-8")?
        .to_owned();
    if !metadata.is_file()
        || !protocol::safe_name(&name)
        || metadata.len() > protocol::MAX_FILE as u64
    {
        return Err("Choose one regular file with a supported filename, up to 1 MiB".into());
    }
    let selected = SelectedFile {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        bytes: metadata.len(),
    };
    *locked(&state.selected)? = Some(Selection {
        file: selected.clone(),
        path,
    });
    Ok(Some(selected))
}
#[tauri::command]
fn send_file(file_id: String, peer: String, state: State<AppState>) -> Result<(), String> {
    let snapshot = locked(&state.snapshot)?;
    let target = snapshot
        .peers
        .iter()
        .find(|target| target.mac == peer && target.advertised)
        .ok_or("Recipient is no longer nearby")?;
    if model::now().saturating_sub(target.last_seen) > 10_000 {
        return Err("Recipient information expired; wait for discovery".into());
    }
    let port = target.port;
    drop(snapshot);
    let mut selection = locked(&state.selected)?;
    let selected = selection
        .as_ref()
        .filter(|selected| selected.file.id == file_id)
        .ok_or("Choose the source file again")?;
    locked(&state.actor)?
        .as_ref()
        .ok_or("Connect the bridge first")?
        .send(selected.path.clone(), peer, port)
        .map_err(|e| e.to_string())?;
    selection.take();
    Ok(())
}
#[tauri::command]
fn cancel_transfer(state: State<AppState>) -> Result<(), String> {
    locked(&state.actor)?
        .as_ref()
        .ok_or("Bridge is disconnected")?
        .cancel();
    Ok(())
}
#[tauri::command]
fn resolve_peer(peer: String, state: State<AppState>) -> Result<(), String> {
    let snapshot = locked(&state.snapshot)?;
    let target = snapshot
        .peers
        .iter()
        .find(|target| target.mac == peer && target.advertised)
        .ok_or("Recipient is no longer nearby")?;
    let port = target.port;
    drop(snapshot);
    locked(&state.actor)?
        .as_ref()
        .ok_or("Connect the bridge first")?
        .resolve(peer, port)
        .map_err(|error| error.to_string())
}
#[tauri::command]
async fn choose_receive_folder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    if locked(&state.actor)?
        .as_ref()
        .is_some_and(|actor| !actor.finished())
    {
        return Err("Disconnect before changing the receive folder".into());
    }
    let folder =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|e| e.to_string())?;
    let Some(folder) = folder else {
        return Ok(None);
    };
    let path = folder.into_path().map_err(|e| e.to_string())?;
    let display = model::display_path(&path);
    *locked(&state.receive_directory)? = path;
    locked(&state.snapshot)?.receive_directory = display.clone();
    Ok(Some(display))
}
#[tauri::command]
fn open_receive_folder(
    transfer_id: Option<String>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    let path = if let Some(id) = transfer_id {
        locked(&state.snapshot)?
            .transfers
            .iter()
            .find(|transfer| {
                transfer.id == id
                    && transfer.direction == "receive"
                    && transfer.state == "completed"
            })
            .and_then(|transfer| transfer.directory.as_ref())
            .map(PathBuf::from)
            .ok_or("Completed receive folder was not found")?
    } else {
        locked(&state.receive_directory)?.clone()
    };
    app.opener()
        .open_path(model::display_path(&path), None::<&str>)
        .map_err(|e| e.to_string())
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let receive = app.path().download_dir()?.join("AirBridge");
            std::fs::create_dir_all(&receive)?;
            let snapshot = Snapshot::new(model::display_path(&receive));
            let log_directory = app.path().app_log_dir()?;
            std::fs::create_dir_all(&log_directory)?;
            let diagnostics = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_directory.join("session.jsonl"))
                .ok();
            app.manage(AppState {
                actor: Mutex::new(None),
                snapshot: Arc::new(Mutex::new(snapshot)),
                selected: Mutex::new(None),
                receive_directory: Mutex::new(receive),
                diagnostics: Mutex::new(diagnostics),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            dismiss_error,
            connect_bridge,
            disconnect_bridge,
            choose_file,
            send_file,
            cancel_transfer,
            resolve_peer,
            choose_receive_folder,
            open_receive_folder
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(mut actor) = window.state::<AppState>().actor.lock() {
                    let stopped = actor.take();
                    tauri::async_runtime::spawn_blocking(move || drop(stopped));
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("AirBridge could not start");
}
