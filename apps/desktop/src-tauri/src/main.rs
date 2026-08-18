#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};

/// Probe 127.0.0.1 for a free port starting at `base` (8471 → 8472 → …).
fn probe_port(base: u16, attempts: u16) -> u16 {
    for offset in 0..attempts {
        let port = base + offset;
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    base
}

/// Spawn the backend sidecar binary bundled via `bundle.externalBin`.
/// Tauri places external binaries next to the app executable under their
/// configured name (without the target-triple suffix).
fn spawn_sidecar(
    exe_dir: &std::path::Path,
    port: u16,
    data_dir: &std::path::Path,
    resource_dir: &std::path::Path,
) -> std::io::Result<Child> {
    let bin = exe_dir.join(if cfg!(windows) {
        "paperweave-backend.exe"
    } else {
        "paperweave-backend"
    });
    let backend_home = resource_dir.join("backend");
    Command::new(&bin)
        .env("PORT", port.to_string())
        .env("DATA_DIR", data_dir)
        .env("PAPERWEAVE_BACKEND_HOME", &backend_home)
        .spawn()
}

fn main() {
    let port = probe_port(8471, 16);
    let sidecar: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let sidecar_exit = Arc::clone(&sidecar);

    // Injected into every frame (the reader iframe builds relative "/api/..."
    // URLs for PDF fetches, bypassing the frontend's apiFetch). apiFetch itself
    // picks up window.__PAPERWEAVE_API_BASE__ via setApiBase; the fetch/XHR
    // rewrite below is a catch-all for callers that don't go through apiFetch.
    let init_script = format!(
        r#"(() => {{
  const BASE = "http://127.0.0.1:{port}";
  window.__PAPERWEAVE_API_BASE__ = BASE;
  const rewrite = (u) => (typeof u === "string" && u.startsWith("/api/")) ? BASE + u : u;
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {{
    if (typeof input === "string") input = rewrite(input);
    else if (input instanceof Request && input.url.startsWith(location.origin + "/api/"))
      input = new Request(BASE + input.url.slice(location.origin.length), input);
    return origFetch(input, init);
  }};
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {{
    return origOpen.call(this, method, rewrite(url), ...rest);
  }};
}})();"#,
        port = port
    );

    let app = tauri::Builder::default()
        .setup(move |app| {
            use tauri::Manager;

            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                .unwrap_or_default();
            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| exe_dir.clone());
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("paperweave"))
                .join("data");
            let _ = std::fs::create_dir_all(&data_dir);

            match spawn_sidecar(&exe_dir, port, &data_dir, &resource_dir) {
                Ok(child) => {
                    *sidecar.lock().unwrap() = Some(child);
                }
                Err(e) => {
                    eprintln!("[paperweave] sidecar spawn failed: {e} (dev mode expects an externally started backend)");
                }
            }

            let url = if cfg!(dev) {
                tauri::WebviewUrl::External("http://localhost:5173".parse().unwrap())
            } else {
                tauri::WebviewUrl::App("index.html".into())
            };
            tauri::WebviewWindowBuilder::new(app, "main", url)
                .title("PaperWeave")
                .inner_size(1440.0, 900.0)
                .initialization_script_for_all_frames(&init_script)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(mut child) = sidecar_exit.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
