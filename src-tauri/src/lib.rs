use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use tauri::{AppHandle, Emitter};

#[tauri::command]
fn start_oauth_server(app: AppHandle) -> Result<(), String> {
  let listener = TcpListener::bind("127.0.0.1:7878")
    .map_err(|e| format!("Failed to start OAuth callback server: {e}"))?;

  std::thread::spawn(move || {
    if let Ok((mut stream, _)) = listener.accept() {
      let request_line = {
        let buf = BufReader::new(&stream);
        buf.lines().next().and_then(|l| l.ok()).unwrap_or_default()
      };

      // "GET /callback?code=...&state=... HTTP/1.1"
      let path = request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .to_string();

      let body = "<html><body><h2>Login successful!</h2><p>You can close this tab and return to lowspot.</p></body></html>";
      let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
      );
      let _ = stream.write_all(response.as_bytes());

      let callback_url = format!("http://127.0.0.1:7878{path}");
      let _ = app.emit("oauth-callback", callback_url);
    }
  });

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![start_oauth_server])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
