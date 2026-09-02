#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]
// BagIdea Office — THE program. One exe runs the whole stack:
//   • spawns the event daemon (node) if not already running
//   • spawns the Godot office (Windows: embedded behind the desktop icons via
//     WorkerW; macOS: a DYLD shim drops it to the desktop window level)
//   • circular chat head (drag anywhere, click toggles the overlay)
//   • frameless rounded overlay with custom chrome
//   • system tray icon — the ONLY place to exit; quitting tears the whole
//     stack down and restores the user's wallpaper.
//
// All OS-specific plumbing lives in the `platform` module: one impl per OS,
// the same surface. `main()` stays platform-neutral.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};

// Flipped true the moment the user quits from the tray, so the daemon watchdog
// stops resurrecting the daemon we're deliberately tearing down.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
// Flipped true by a Unix signal handler (SIGTERM/SIGINT) so the event loop
// picks up the shutdown on its next tick — same cleanup path as tray Exit.
static SIGNAL_SHUTDOWN: AtomicBool = AtomicBool::new(false);

// On Linux the embedded WebKitGTK overlay can render completely blank on some
// setups (confirmed on DGX Spark / ARM64 / X11: the page loads, DOM + styles are
// present, but nothing paints — even trivial standalone test pages stay blank).
// It's a platform/driver rendering issue, not an app bug, and we can't fix it
// from here. So on those setups we open the chat in the system browser instead
// (the daemon serves the full UI at 127.0.0.1:8787) and keep the blank overlay
// hidden. Default on for aarch64 Linux; BAGIDEA_BROWSER_CHAT=1|0 overrides.
fn browser_chat() -> bool {
    if cfg!(not(target_os = "linux")) {
        return false;
    }
    match std::env::var("BAGIDEA_BROWSER_CHAT").ok().as_deref() {
        Some("1") => return true,
        Some("0") => return false,
        _ => {}
    }
    cfg!(target_arch = "aarch64")
}

// Open (or focus) the chat in an external browser — the Linux/aarch64 path where the
// embedded overlay renders blank. Tries, in order: focus an already-open BagIdeaOffice
// window (no duplicate tabs); else a Chromium/Chrome app window (dedicated, focusable,
// sets WM_CLASS=BagIdeaOffice so the next Open re-focuses it); else the system default
// browser via xdg-open. Never makes any of these a hard requirement.
fn open_chat_browser() {
    let url = "http://127.0.0.1:8787/";
    // 1) Restore/focus an already-open BagIdeaOffice window. wmctrl -x -a reliably
    //    un-minimizes on GNOME/Mutter — xdotool windowactivate activates but leaves a
    //    minimized window minimized, so Open "did nothing" after minimize. Check the
    //    window exists first: wmctrl -a is a silent no-op when nothing matches.
    let exists = std::process::Command::new("sh")
        .args(["-c", "wmctrl -lx 2>/dev/null | grep -qi BagIdeaOffice"])
        .status().map(|s| s.success()).unwrap_or(false);
    if exists {
        let _ = std::process::Command::new("wmctrl")
            .args(["-x", "-a", "BagIdeaOffice"]).status();
        return;
    }
    // No window yet (or wmctrl missing) — xdotool focus as a backup before launching.
    let focused = std::process::Command::new("sh")
        .args(["-c", "wid=$(xdotool search --class BagIdeaOffice 2>/dev/null | head -1); [ -n \"$wid\" ] && xdotool windowactivate \"$wid\""])
        .status().map(|s| s.success()).unwrap_or(false);
    if focused { return; }
    // 2) A Chromium/Chrome-family app window (no tab chrome, its own taskbar entry).
    for b in ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "brave-browser", "microsoft-edge"] {
        let ok = std::process::Command::new(b)
            .args([format!("--app={url}"), "--class=BagIdeaOffice".into()])
            .spawn().is_ok();
        if ok { return; }
    }
    // 3) Fall back to the system default browser.
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}


use tao::{
    dpi::{LogicalPosition, LogicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::{Icon, Window, WindowBuilder},
};
use tray_icon::{
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    TrayIconBuilder, TrayIconEvent,
};

const ORB_SIZE: f64 = 78.0;  // window; the orb art is inset ~3px so a thin transparent
                             // halo sits between the glow and the circular clip edge — the
                             // clip then cuts empty space, not the glow against the wallpaper.
const FULL: (f64, f64) = (560.0, 700.0);
const MINI: (f64, f64) = (390.0, 430.0);
// Large mode: free-resizable reading/working window. Opens at ~86% of the
// screen, centered; can never shrink below FULL (that's what MINI is for).
const LARGE_FRAC: f64 = 0.86;
const FEED_W: f64 = 330.0;
// 📡 feed mode's window alpha. Resting is the house translucency the mode has
// always had; pointing at the strip means you are reading it, so it firms up.
const FEED_ALPHA: u8 = 196;
const FEED_ALPHA_READ: u8 = 245;
const PARK: (f64, f64) = (-9000.0, 100.0);
const SPLASH_SIZE: f64 = 210.0;

#[derive(Debug)]
enum UserEvent {
    Toggle,
    DragOrb,
    DragOverlay,
    HideOverlay,
    MiniToggle,
    LargeToggle, // big resizable window (min size = FULL) for reading / real work
    ResizeDrag(String), // large mode: JS edge-zones start an OS resize drag (the
                        // webview covers the whole window, so native borders never
                        // see the mouse — "resize:<n|s|e|w|ne|nw|se|sw>")
    FeedToggle,
    FeedHover(bool), // pointer entered/left the feed strip → firm it up for reading
    SetHotkey(String),
    PttKey(bool), // global voice hotkey: true = pressed, false = released
    WorldReady,
    EditorOpening, // show the logo splash + launch the 3D editor tiny behind it
    EditorReady,   // the editor window is on screen → drop the splash
    OpenWindow(String), // pop a custom-chrome window onto a daemon URL (plugin / viewer)
    PopupDrag(tao::window::WindowId),  // a pop-out's title bar is being dragged
    PopupClose(tao::window::WindowId), // a pop-out asked to close itself
    PopupMin(tao::window::WindowId),   // minimize (พัก)
    PopupMax(tao::window::WindowId),   // toggle maximize / restore
}

// Run a child process without flashing a console window (Windows); a no-op
// elsewhere.
fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

// ----------------------------------------------------------------- HTML chrome
const SPLASH_HTML: &str = r#"<!doctype html>
<html><body style="margin:0;overflow:hidden;background:transparent">
<img src="__LOGO__" draggable="false"
     style="position:absolute;left:0;top:0;width:100%;height:100%;animation:p 1.5s ease-in-out infinite">
<style>@keyframes p{0%,100%{transform:scale(1)}50%{transform:scale(0.92)}}</style>
</body></html>"#;

const ORB_HTML: &str = r#"<!doctype html>
<html><body style="margin:0;overflow:hidden;background:transparent;user-select:none;-webkit-user-select:none;cursor:default">
<img id="disc" src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><radialGradient id='d' cx='50%25' cy='50%25' r='50%25'><stop offset='0' stop-color='%230d1430'/><stop offset='1' stop-color='%2305060f'/></radialGradient></defs><circle cx='50' cy='50' r='49' fill='url(%23d)'/><circle cx='30' cy='26' r='0.7' fill='%23ffffff' opacity='0.7'/><circle cx='73' cy='69' r='0.6' fill='%23cfe3ff' opacity='0.6'/><circle cx='66' cy='22' r='0.5' fill='%23ffffff' opacity='0.5'/><circle cx='27' cy='60' r='0.5' fill='%23ffffff' opacity='0.45'/></svg>" draggable="false">
<img id="logo" src="__LOGO__" draggable="false">
<img id="ring" src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='1' x2='0.25' y2='0'><stop offset='0' stop-color='%2322d3ff'/><stop offset='0.5' stop-color='%235b8cff'/><stop offset='1' stop-color='%23c850ff'/></linearGradient><filter id='b' x='-40%25' y='-40%25' width='180%25' height='180%25'><feGaussianBlur stdDeviation='1.7'/></filter></defs><circle cx='50' cy='50' r='47' fill='none' stroke='url(%23g)' stroke-width='4.5' filter='url(%23b)' opacity='1'/><circle cx='50' cy='50' r='47' fill='none' stroke='url(%23g)' stroke-width='2' stroke-linecap='round'/></svg>" draggable="false">
<style>
  /* Neon energy-loop orb (after the reference): a dark starry coin, a glowing cyan→purple
     ring that slowly TURNS so the light flows around the loop, and the logo glowing in the
     middle. All stacked SVG/PNG images so they composite cleanly on the transparent window
     (CSS rounded/conic divs went black here). object-fit:contain keeps each a true circle. */
  /* inset leaves a thin transparent halo so the window's circular clip edge falls on
     empty space, not on the glowing rim (which looked jagged against the wallpaper). */
  img { position:absolute; inset:3px; width:calc(100% - 6px); height:calc(100% - 6px); object-fit:contain; }
  #ring { animation: spin 4s linear infinite, flicker 3.4s ease-in-out infinite; will-change:transform,opacity; }
  #logo { animation: breathe 3.6s ease-in-out infinite; will-change:transform; }
  body.busy #ring { animation-duration: 1.6s, 1.5s; }   /* working = the loop swirls faster */
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes flicker { 0%,100% { opacity:0.8; } 50% { opacity:1; } }
  @keyframes breathe { 0%,100% { transform: scale(0.94); } 50% { transform: scale(0.915); } }
</style>
<script>
  // Live pulse: the ring knows when the office is actually working.
  let busy = 0;
  function wire() {
    try {
      const ws = new WebSocket('ws://127.0.0.1:8787/ws');
      ws.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data);
          if (e.replay) return;
          if (e.type === 'task.started') busy++;
          else if (e.type === 'task.completed' || e.type === 'task.failed') busy = Math.max(0, busy - 1);
          document.body.classList.toggle('busy', busy > 0);
        } catch {}
      };
      ws.onclose = () => { busy = 0; document.body.classList.remove('busy'); setTimeout(wire, 5000); };
    } catch { setTimeout(wire, 5000); }
  }
  wire();
</script>
<script>
  // Only the visible circle is interactive. The window is a square, so its
  // transparent corners would otherwise still catch press/drag/click — an
  // "invisible grab box" around the orb. Ignore any pointer event whose point
  // falls outside the inscribed circle (DPI-independent, no SetWindowRgn needed).
  function inCircle(e) {
    const r = Math.min(window.innerWidth, window.innerHeight) / 2;
    return Math.hypot(e.clientX - window.innerWidth / 2,
                      e.clientY - window.innerHeight / 2) <= r;
  }
  // Messenger chat-head feel: press-and-move drags, clean click toggles.
  let downAt = null, dragged = false;
  document.body.addEventListener('mousedown', (e) => {
    if (e.button === 0 && inCircle(e)) { downAt = [e.screenX, e.screenY]; dragged = false; }
  });
  document.body.addEventListener('mousemove', (e) => {
    // Hand cursor only over the orb itself — the corners stay a plain arrow so
    // they don't look/feel like an interactive window.
    document.body.style.cursor = inCircle(e) ? 'pointer' : 'default';
    if (downAt && !dragged &&
        Math.hypot(e.screenX - downAt[0], e.screenY - downAt[1]) > 10) {
      dragged = true;
      window.ipc.postMessage('drag-orb');
    }
  });
  document.body.addEventListener('mouseup', () => { downAt = null; });
  document.body.addEventListener('click', (e) => {
    if (!dragged && inCircle(e)) window.ipc.postMessage('toggle');
    dragged = false;
  });
  // Right-click flips chat ↔ streamer feed (a quiet right-edge status strip).
  document.body.addEventListener('contextmenu', (e) => {
    if (!inCircle(e)) return;
    e.preventDefault();
    window.ipc.postMessage('mode');
  });
</script>
</body></html>"#;

// The orb's logo is EMBEDDED in the binary as a data: URI rather than fetched from the
// daemon over HTTP. On a cold boot the shell paints the orb before the daemon's web
// server is up, so an HTTP <img> would 404 and the orb would sit dark until a manual
// restart. Baking the bytes in removes that dependency entirely — the orb always shows.
fn logo_data_uri() -> String {
    const LOGO: &[u8] = include_bytes!("../../logo_ico_cute.png");
    format!("data:image/png;base64,{}", base64_encode(LOGO))
}
fn orb_html() -> String { ORB_HTML.replace("__LOGO__", &logo_data_uri()) }
fn splash_html() -> String { SPLASH_HTML.replace("__LOGO__", &logo_data_uri()) }

fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let n = ((chunk[0] as u32) << 16)
            | ((*chunk.get(1).unwrap_or(&0) as u32) << 8)
            | (*chunk.get(2).unwrap_or(&0) as u32);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

// ----------------------------------------------------------- shared orchestration
fn project_root() -> PathBuf {
    // Walk up from the exe until we find the repo root (has daemon/server.js).
    if let Ok(exe) = std::env::current_exe() {
        for dir in exe.ancestors() {
            if dir.join("daemon").join("server.js").exists() {
                return dir.to_path_buf();
            }
        }
    }
    PathBuf::from(".")
}

fn daemon_running() -> bool {
    std::net::TcpStream::connect_timeout(
        &"127.0.0.1:8787".parse().unwrap(),
        std::time::Duration::from_millis(400),
    )
    .is_ok()
}

// Give the daemon a fair chance to come up before deciding it is unreachable.
// Node's boot is not instant on a cold or busy machine, and calling it dead too
// early would be its own bug — so poll, and only give up after a long wait.
fn wait_for_daemon(max: std::time::Duration) -> bool {
    let start = std::time::Instant::now();
    loop {
        if daemon_running() {
            return true;
        }
        if start.elapsed() >= max {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
}

// What the chat window shows when it cannot reach the daemon at all.
//
// It used to show nothing: a blank window, no text, no error, no hint. On a
// customer's machine where something was blocking loopback, that is exactly
// what they got — and the person who installed it had to go through the
// firewall and the proxy by hand to work out why, while the customer sat in
// front of a window that told them nothing.
//
// Embedded, not fetched: the one thing we know in this state is that we cannot
// fetch anything. It re-tries on its own, so a daemon that is merely slow heals
// without anyone touching it.
const OFFLINE_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8"><style>
 html,body{margin:0;height:100%;font:13px/1.6 system-ui,Segoe UI,sans-serif;
   background:linear-gradient(160deg,#15203a 0%,#0c1322 70%);color:#dbe6f5}
 .w{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 26px;box-sizing:border-box}
 h1{font-size:14px;letter-spacing:2px;color:#5ec8ff;margin:0 0 10px}
 p{margin:0 0 10px;color:#9fb2cc}
 code{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);
   border-radius:6px;padding:2px 7px;color:#ffd28a;font-size:12.5px}
 ul{margin:0 0 12px 18px;padding:0;color:#9fb2cc} li{margin:3px 0}
 .r{margin-top:4px;font-size:11.5px;color:#6b7a92}
 button{font:inherit;font-weight:600;color:#ffd28a;background:rgba(255,210,138,.08);
   border:1px solid rgba(255,210,138,.35);border-radius:10px;padding:7px 15px;cursor:pointer;
   align-self:flex-start}
</style></head><body><div class="w">
 <h1>&#9888; CAN'T REACH THE OFFICE</h1>
 <p>The office runs on <code>127.0.0.1:8787</code> and this window can't get to it.
    That is almost never the office itself &mdash; it is something on this machine
    standing between the two.</p>
 <ul>
   <li>a <b>proxy</b> that doesn't exempt local addresses</li>
   <li>a <b>firewall</b> or antivirus blocking loopback</li>
   <li>the daemon didn't start</li>
 </ul>
 <p>Run this in a terminal &mdash; it checks all three and prints the fix:</p>
 <p><code>bagidea doctor</code></p>
 <button onclick="go()">Try again</button>
 <div class="r" id="r"></div>
</div><script>
 var n=0;
 function go(){ location.href='http://127.0.0.1:8787/'; }
 // Heal on its own if the daemon was merely slow, backing off so a genuinely
 // blocked machine isn't hammered.
 function tick(){ n++; document.getElementById('r').textContent='retrying automatically… ('+n+')';
   go(); setTimeout(tick, Math.min(30000, 3000*n)); }
 setTimeout(tick, 3000);
</script></body></html>"#;

fn spawn_daemon(root: &PathBuf) -> Option<Child> {
    if daemon_running() {
        return None;
    }
    let mut c = Command::new("node");
    c.arg(root.join("daemon").join("server.js"));
    // Mark the daemon as shell-spawned so it enables parent-death detection
    // (polls our PID and self-shuts-down if we crash/exit, instead of going
    // orphan on PID 1 and holding port 8787 forever). A manual `node server.js`
    // from a terminal won't have this env var, so it won't false-positive.
    c.env("OEP_SPAWNED", "1");
    // A release GUI shell has NO console (windows_subsystem="windows"), so an
    // INHERITED stdout/stderr is an invalid handle and node can crash on its
    // first write — taking the daemon down seconds after launch. Send the
    // daemon's output to daemon/daemon.log instead: keeps it alive AND gives a
    // log to read. Fall back to /dev/null-equivalent if the file can't open.
    use std::process::Stdio;
    match std::fs::File::create(root.join("daemon").join("daemon.log")) {
        Ok(f) => {
            match f.try_clone() {
                Ok(f2) => { c.stdout(Stdio::from(f)).stderr(Stdio::from(f2)); }
                Err(_) => { c.stdout(Stdio::from(f)).stderr(Stdio::null()); }
            }
        }
        Err(_) => { c.stdout(Stdio::null()).stderr(Stdio::null()); }
    }
    hidden(&mut c).spawn().ok()
}

fn spawn_office(root: &PathBuf, cx: i32, cy: i32) -> Option<Child> {
    let godot = platform::godot_exe(root);
    if !std::path::Path::new(&godot).exists() {
        return None; // overlay-only mode
    }
    let mut c = Command::new(godot);
    platform::office_args(&mut c, root, cx, cy);
    hidden(&mut c).spawn().ok()
}

fn spawn_editor(root: &PathBuf, cx: i32, cy: i32) -> Option<Child> {
    let godot = platform::godot_exe(root);
    if !std::path::Path::new(&godot).exists() {
        return None;
    }
    let mut c = Command::new(godot);
    c.args(["--path"])
        .arg(root.join("godot"))
        .args(["--resolution", "64x64"])
        .arg("--position")
        .arg(format!("{},{}", cx - 32, cy - 32))
        .args(["--", "--editor3d"]);
    hidden(&mut c).spawn().ok()
}

// Watch for the daemon's "open the editor" request, then for the editor's
// "ready" handoff — drives the splash show/hide via the event loop.
fn watch_editor_requests(proxy: tao::event_loop::EventLoopProxy<UserEvent>) {
    std::thread::spawn(move || {
        let req = std::env::temp_dir().join("bagidea_editor_open_request");
        let ready = std::env::temp_dir().join("bagidea_editor_ready");
        let _ = std::fs::remove_file(&req);
        loop {
            if req.exists() {
                let _ = std::fs::remove_file(&req);
                let _ = std::fs::remove_file(&ready);
                let _ = proxy.send_event(UserEvent::EditorOpening);
                let start = std::time::SystemTime::now();
                loop {
                    let fresh = std::fs::metadata(&ready)
                        .and_then(|x| x.modified())
                        .map(|t| t >= start)
                        .unwrap_or(false);
                    if fresh || start.elapsed().unwrap_or_default() > std::time::Duration::from_secs(60) {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
                let _ = proxy.send_event(UserEvent::EditorReady);
            }
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
    });
}

/// Fire-and-forget visibility event to the daemon (curl ships with both OSes).
fn post_visibility(on: bool) {
    let mut c = Command::new("curl");
    c.args(["-s", "-X", "POST", "http://127.0.0.1:8787/event",
        "-H", "content-type: application/json",
        "-d", &format!("{{\"type\":\"ui.visibility\",\"on\":{}}}", on)]);
    let _ = hidden(&mut c).spawn();
}

/// Tell the daemon how many monitors we detected, so the overlay shows a display
/// picker only on multi-monitor (and with the right count). Fire-and-forget.
fn post_monitor_count(count: usize) {
    let mut c = Command::new("curl");
    c.args(["-s", "-X", "POST", "http://127.0.0.1:8787/ui/monitors",
        "-H", "content-type: application/json",
        "-d", &format!("{{\"count\":{}}}", count)]);
    let _ = hidden(&mut c).spawn();
}

/// Ask the daemon to relaunch the whole stack (it does the detached restart that
/// survives killing us). Used by the tray "Restart office" item.
fn post_restart() {
    let mut c = Command::new("curl");
    c.args(["-s", "-X", "POST", "http://127.0.0.1:8787/ui/restart",
        "-H", "content-type: application/json", "-H", "x-bagidea-ui: 1"]);
    let _ = hidden(&mut c).spawn();
}

/// Debug beacon: stages of the hotkey chain reported to the daemon.
fn ptt_beacon(stage: &str) {
    let body = format!(r#"{{"type":"ui.ptt","stage":"{}"}}"#, stage);
    let mut c = Command::new("curl");
    c.args(["-s", "-X", "POST", "http://127.0.0.1:8787/event",
        "-H", "content-type: application/json", "-d", &body]);
    let _ = hidden(&mut c).spawn();
}

fn icon_rgba() -> Option<(Vec<u8>, u32, u32)> {
    let img = image::load_from_memory(include_bytes!("../../godot/assets/brand/logo_ico_cute.png"))
        .ok()?
        .into_rgba8();
    let (w, h) = img.dimensions();
    Some((img.into_raw(), w, h))
}

fn app_icon() -> Option<Icon> {
    let (rgba, w, h) = icon_rgba()?;
    Icon::from_rgba(rgba, w, h).ok()
}

fn tray_app_icon() -> Option<tray_icon::Icon> {
    let (rgba, w, h) = icon_rgba()?;
    tray_icon::Icon::from_rgba(rgba, w, h).ok()
}

// =====================================================================
//  Windows platform implementation
// =====================================================================
#[cfg(windows)]
mod platform {
    use super::{ptt_beacon, UserEvent};
    use std::path::PathBuf;
    use std::process::Command;
    use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
    use tao::window::{Window, WindowBuilder};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{
        CreateEllipticRgn, CreateRectRgn, CreateRoundRectRgn, SetWindowRgn,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetAncestor, GetClassNameW, GetWindowLongW,
        GetWindowThreadProcessId, GetWindowRect, IsIconic, IsWindow,
        IsWindowVisible, SendMessageTimeoutW, SetLayeredWindowAttributes, SetParent,
        SetWindowLongW, ShowWindow, SystemParametersInfoW, GA_PARENT, GWL_EXSTYLE,
        LWA_ALPHA, SMTO_NORMAL, SPI_SETDESKWALLPAPER, SW_HIDE, SW_SHOW,
        WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };
    use std::io::Write;

    static PTT_THREAD_ID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    // Hold-to-talk via a low-level keyboard hook: the bound key, whether it's
    // currently held (to swallow auto-repeat), and a proxy the C callback can
    // reach to fire PttKey(down/up) into the event loop.
    static PTT_VK: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0x75); // VK_F6
    static PTT_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    // True while the user has hidden the office from the tray — the re-pin
    // watcher (issue #7) must NOT fight that by re-showing the window.
    static WALLPAPER_HIDDEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    // The CURRENT world (Godot) process id. The supervisor thread relaunches the
    // world when Windows destroys its window (WorkerW teardown), so the live pid
    // drifts from the one main first spawned — everything that needs the world's
    // pid (tray hide, exit cleanup) reads this, not the stale local.
    static WORLD_PID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    static PTT_PROXY: std::sync::Mutex<Option<tao::event_loop::EventLoopProxy<super::UserEvent>>> =
        std::sync::Mutex::new(None);

    fn ptt_send(down: bool) {
        if let Ok(g) = PTT_PROXY.lock() {
            if let Some(p) = g.as_ref() {
                let _ = p.send_event(super::UserEvent::PttKey(down));
            }
        }
    }

    // Low-level keyboard hook proc — sees every key, acts only on the bound one,
    // and ALWAYS chains so normal typing is never blocked or delayed.
    unsafe extern "system" fn ll_kbd(code: i32, wparam: usize, lparam: isize) -> isize {
        use std::sync::atomic::Ordering;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CallNextHookEx, HC_ACTION, KBDLLHOOKSTRUCT, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN,
            WM_SYSKEYUP,
        };
        if code == HC_ACTION as i32 && !lparam_is_null(lparam) {
            let kb = &*(lparam as *const KBDLLHOOKSTRUCT);
            if kb.vkCode == PTT_VK.load(Ordering::Relaxed) {
                let w = wparam as u32;
                if w == WM_KEYDOWN || w == WM_SYSKEYDOWN {
                    if !PTT_DOWN.swap(true, Ordering::SeqCst) {
                        ptt_send(true);
                    }
                } else if w == WM_KEYUP || w == WM_SYSKEYUP {
                    if PTT_DOWN.swap(false, Ordering::SeqCst) {
                        ptt_send(false);
                    }
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }
    fn lparam_is_null(l: isize) -> bool { l == 0 }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn parse_vk(s: &str) -> Option<(u32, u32)> {
        let mut mods = 0u32;
        let mut vk = None;
        for part in s.to_lowercase().split('+') {
            match part.trim() {
                "ctrl" | "control" => mods |= 0x0002,
                "shift" => mods |= 0x0004,
                "alt" => mods |= 0x0001,
                // single keys that suit hold-to-talk (the low-level hook reports
                // the distinct left/right vkCodes, so Right Ctrl matches only the
                // right key). Right Ctrl is the recommended default — rarely typed.
                "rctrl" | "rightctrl" | "right ctrl" => vk = Some(0xA3), // VK_RCONTROL
                "ralt" | "rightalt" | "right alt" => vk = Some(0xA5),   // VK_RMENU
                "rshift" | "rightshift" => vk = Some(0xA1),             // VK_RSHIFT
                "space" => vk = Some(0x20u32),
                "f5" => vk = Some(0x74),
                "f6" => vk = Some(0x75),
                "f7" => vk = Some(0x76),
                "f8" => vk = Some(0x77),
                "f9" => vk = Some(0x78),
                "f10" => vk = Some(0x79),
                "none" | "" => return None,
                _ => {}
            }
        }
        vk.map(|v| (mods, v))
    }

    pub fn godot_exe(root: &PathBuf) -> String {
        let branded = root.join("godot").join("bin").join("BagIdeaOffice.exe");
        if branded.exists() {
            return branded.to_string_lossy().into_owned();
        }
        // BAGIDEA_GODOT only counts when it actually points at a file — the
        // installer used to set it even when the Godot download failed.
        if let Ok(g) = std::env::var("BAGIDEA_GODOT") {
            if std::path::Path::new(&g).exists() {
                return g;
            }
        }
        // Installer's real download location (branding step may have been skipped).
        if let Ok(la) = std::env::var("LOCALAPPDATA") {
            let p = std::path::PathBuf::from(la)
                .join("BagIdeaOffice").join("tools").join("godot")
                .join("Godot_v4.6.3-stable_win64.exe");
            if p.exists() {
                return p.to_string_lossy().into_owned();
            }
        }
        r"E:\Tools\Godot\Godot_v4.6.3-stable_win64.exe".into()
    }

    pub fn office_args(c: &mut Command, root: &PathBuf, cx: i32, cy: i32) {
        // Born 64px DEAD CENTER — under the shell's circular splash, so the
        // loading window hides behind the logo. office_floor.gd grows it.
        c.args(["--path"])
            .arg(root.join("godot"))
            .args(["--resolution", "64x64"])
            .arg("--position")
            .arg(format!("{},{}", cx - 32, cy - 32))
            .args(["--", "--wallpaper"]);
    }

    pub fn ensure_single_instance() -> bool {
        unsafe {
            use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
            use windows_sys::Win32::System::Threading::CreateMutexW;
            let name = wide("BagIdeaOfficeShellSingleton");
            CreateMutexW(std::ptr::null(), 0, name.as_ptr());
            GetLastError() != ERROR_ALREADY_EXISTS
        }
    }

    pub fn spawn_hotkey_thread(proxy: tao::event_loop::EventLoopProxy<UserEvent>) {
        if let Some((_m, v)) = parse_vk("rctrl") {
            PTT_VK.store(v, std::sync::atomic::Ordering::SeqCst);
        }
        // The C hook callback reaches the event loop through this static.
        if let Ok(mut g) = PTT_PROXY.lock() { *g = Some(proxy); }
        std::thread::spawn(move || unsafe {
            use std::sync::atomic::Ordering;
            use windows_sys::Win32::System::Threading::GetCurrentThreadId;
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                GetMessageW, SetTimer, SetWindowsHookExW, UnhookWindowsHookEx, MSG,
                WH_KEYBOARD_LL, WM_APP, WM_TIMER,
            };
            PTT_THREAD_ID.store(GetCurrentThreadId(), Ordering::SeqCst);
            // A low-level keyboard hook delivers BOTH key-down and key-up, which
            // RegisterHotKey never did (press-only → the old press-to-start /
            // press-to-stop toggle). The hook callback is dispatched on the
            // thread that installed it, so we must keep pumping messages here.
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(ll_kbd), std::ptr::null_mut(), 0);
            ptt_beacon(if hook.is_null() { "register-FAILED" } else { "registered" });
            // Self-healing watchdog: the LL hook can miss a key event when focus
            // changes around the moment of a press (the reported "hold the hotkey
            // and nothing happens, then it works after clicking elsewhere"). A
            // missed key-UP would leave PTT_DOWN stuck true so the next real
            // key-DOWN is swallowed as auto-repeat — PTT goes dead until a stray
            // key-up finally arrives. Every ~150ms we reconcile our tracked state
            // with the key's REAL physical state (GetAsyncKeyState) and fire the
            // transition we missed, so the hotkey can never wedge. (WM_TIMER from
            // a NULL-hwnd timer is delivered to this thread's GetMessageW pump.)
            SetTimer(std::ptr::null_mut(), 1, 150, None);
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                if msg.message == WM_APP {
                    // rebind: switch the watched key (lParam carries the new vk).
                    let vk = msg.lParam as u32;
                    if vk != 0 {
                        PTT_VK.store(vk, Ordering::SeqCst);
                        PTT_DOWN.store(false, Ordering::SeqCst);
                        ptt_beacon("rehook-ok");
                    } else {
                        ptt_beacon("rehook-none");
                    }
                } else if msg.message == WM_TIMER {
                    let vk = PTT_VK.load(Ordering::Relaxed) as i32;
                    let phys_down = (GetAsyncKeyState(vk) as u16 & 0x8000) != 0;
                    let tracked = PTT_DOWN.load(Ordering::Relaxed);
                    if phys_down && !tracked {
                        if !PTT_DOWN.swap(true, Ordering::SeqCst) {
                            ptt_send(true);
                            ptt_beacon("resync-down");
                        }
                    } else if !phys_down && tracked {
                        if PTT_DOWN.swap(false, Ordering::SeqCst) {
                            ptt_send(false);
                            ptt_beacon("resync-up");
                        }
                    }
                }
            }
            if !hook.is_null() {
                UnhookWindowsHookEx(hook);
            }
        });
    }

    pub fn rebind_hotkey(s: &str) {
        use std::sync::atomic::Ordering;
        use windows_sys::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_APP};
        let tid = PTT_THREAD_ID.load(Ordering::SeqCst);
        if tid == 0 {
            return;
        }
        let (mods, vk) = parse_vk(s).unwrap_or((0, 0));
        unsafe {
            PostThreadMessageW(tid, WM_APP, mods as usize, vk as isize);
        }
    }

    unsafe extern "system" fn find_workerw_cb(top: HWND, out: windows_sys::Win32::Foundation::LPARAM) -> i32 {
        let shell_class = wide("SHELLDLL_DefView");
        let shell = FindWindowExW(top, 0 as HWND, shell_class.as_ptr(), std::ptr::null());
        if shell != 0 as HWND {
            let worker_class = wide("WorkerW");
            let worker = FindWindowExW(0 as HWND, top, worker_class.as_ptr(), std::ptr::null());
            if worker != 0 as HWND {
                *(out as *mut HWND) = worker;
            }
        }
        1
    }

    struct FindByPid {
        pid: u32,
        hwnd: HWND,
    }

    unsafe extern "system" fn find_by_pid_cb(h: HWND, lp: windows_sys::Win32::Foundation::LPARAM) -> i32 {
        let data = &mut *(lp as *mut FindByPid);
        let mut pid = 0u32;
        GetWindowThreadProcessId(h, &mut pid);
        if pid == data.pid && IsWindowVisible(h) != 0 {
            data.hwnd = h;
            return 0;
        }
        1
    }

    fn find_wallpaper_hwnd(pid: u32) -> HWND {
        unsafe {
            let progman_class = wide("Progman");
            let progman = FindWindowW(progman_class.as_ptr(), std::ptr::null());
            let mut workerw: HWND = 0 as HWND;
            EnumWindows(Some(find_workerw_cb), &mut workerw as *mut HWND as _);
            if workerw == 0 as HWND {
                let worker_class = wide("WorkerW");
                workerw = FindWindowExW(progman, 0 as HWND, worker_class.as_ptr(), std::ptr::null());
                if workerw == 0 as HWND {
                    workerw = progman;
                }
            }
            let mut child = FindWindowExW(workerw, 0 as HWND, std::ptr::null(), std::ptr::null());
            while child != 0 as HWND {
                let mut wpid = 0u32;
                GetWindowThreadProcessId(child, &mut wpid);
                if wpid == pid {
                    return child;
                }
                child = FindWindowExW(workerw, child, std::ptr::null(), std::ptr::null());
            }
            0 as HWND
        }
    }

    /// Ask Progman to spawn (or reveal) the WorkerW that sits behind the desktop
    /// icons, then return it. Used at boot AND by the re-embed watcher below when
    /// Windows has torn down the old WorkerW (wallpaper/slideshow change, display
    /// mode change, Explorer/DWM restart, lock/RDP). Falls back to Progman itself
    /// so we always have a live desktop-level parent to embed into.
    unsafe fn spawn_workerw() -> HWND {
        let progman_class = wide("Progman");
        let progman = FindWindowW(progman_class.as_ptr(), std::ptr::null());
        let mut result: usize = 0;
        SendMessageTimeoutW(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000, &mut result);
        let mut workerw: HWND = 0 as HWND;
        EnumWindows(Some(find_workerw_cb), &mut workerw as *mut HWND as _);
        if workerw == 0 as HWND {
            let worker_class = wide("WorkerW");
            workerw = FindWindowExW(progman, 0 as HWND, worker_class.as_ptr(), std::ptr::null());
            if workerw == 0 as HWND {
                workerw = progman;
            }
        }
        workerw
    }

    /// Is `h` one of the desktop-shell layers we embed into? A window we SetParent'd
    /// into WorkerW is NOT WS_CHILD, so when Windows destroys that WorkerW our window
    /// isn't destroyed with it — it's reparented to the desktop and drops behind
    /// everything (the "wallpaper vanished" report). GetAncestor(GA_PARENT) then returns
    /// the desktop (a non-shell window); this returns false and the watcher re-embeds.
    unsafe fn is_wallpaper_layer(h: HWND) -> bool {
        if h == 0 as HWND {
            return false;
        }
        let mut cls = [0u16; 32];
        let n = GetClassNameW(h, cls.as_mut_ptr(), cls.len() as i32);
        let name = String::from_utf16_lossy(&cls[..n.max(0) as usize]);
        name == "WorkerW" || name == "Progman"
    }

    /// Place the wallpaper window over the chosen monitor (default: primary),
    /// in WorkerW client coords. WorkerW spans the whole virtual desktop, so its
    /// origin is the virtual-screen origin. Without this the reparented window
    /// kept Godot's (0,0)+primary-size guess, which on a multi-monitor setup
    /// lands on the wrong monitor (or off-screen) — so the wallpaper never
    /// appeared. `BAGIDEA_MONITOR=<index>` (0 = primary) picks another monitor.
    /// All monitors as (left, top, w, h, is_primary), PRIMARY FIRST (so index 0
    /// is always the primary screen). The single source of truth for both the
    /// count we report to the UI and where we place the wallpaper.
    pub fn enum_monitors() -> Vec<(i32, i32, i32, i32, bool)> {
        unsafe {
            use windows_sys::Win32::Foundation::{LPARAM, RECT};
            use windows_sys::Win32::Graphics::Gdi::{
                EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
            };
            struct Mons { v: Vec<(i32, i32, i32, i32, bool)> }
            unsafe extern "system" fn cb(h: HMONITOR, _dc: HDC, _r: *mut RECT, lp: LPARAM) -> i32 {
                let m = &mut *(lp as *mut Mons);
                let mut mi: MONITORINFO = std::mem::zeroed();
                mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
                if GetMonitorInfoW(h, &mut mi) != 0 {
                    let r = mi.rcMonitor;
                    m.v.push((r.left, r.top, r.right - r.left, r.bottom - r.top, mi.dwFlags & 1 != 0));
                }
                1
            }
            let mut mons = Mons { v: Vec::new() };
            EnumDisplayMonitors(0 as HDC, std::ptr::null(), Some(cb), &mut mons as *mut Mons as LPARAM);
            mons.v.sort_by_key(|m| !m.4); // primary first → index 0 is always primary
            mons.v
        }
    }

    fn position_wallpaper(godot: HWND, workerw: HWND, root: &std::path::Path) {
        unsafe {
            use windows_sys::Win32::Foundation::RECT;
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                GetClientRect, GetSystemMetrics, MoveWindow, SM_CXSCREEN, SM_CXVIRTUALSCREEN,
                SM_CYSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
            };
            let mons = enum_monitors();
            // Chosen monitor: daemon/monitor.txt (set from the in-app picker) wins,
            // then the BAGIDEA_MONITOR env, else 0 (primary). Plain int — no JSON dep.
            let idx = std::fs::read_to_string(root.join("daemon").join("monitor.txt"))
                .ok()
                .and_then(|s| s.trim().parse::<usize>().ok())
                .or_else(|| std::env::var("BAGIDEA_MONITOR").ok().and_then(|s| s.trim().parse::<usize>().ok()))
                .unwrap_or(0);
            let vsx = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let vsy = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let vcx = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let vcy = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            // The monitor the user picked, and the primary (index 0) we fall back to.
            let chosen = mons
                .get(idx)
                .or_else(|| mons.first())
                .copied()
                .unwrap_or((0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN), true));
            let primary = mons.first().copied().unwrap_or(chosen);

            // WorkerW client (0,0) is the virtual-screen origin and it SHOULD span the
            // whole virtual desktop. On many real setups, though, it only covers the
            // PRIMARY monitor — so a wallpaper moved onto a secondary monitor lands
            // outside it and is clipped to nothing (the reported multi-monitor "it
            // flashes, then vanishes"). Measure WorkerW so we can refuse a placement
            // that would make the wallpaper invisible, and fall back to the primary,
            // which is always reachable. Never moves it somewhere it can't be seen.
            let mut wc = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            let have_wc = GetClientRect(workerw, &mut wc) != 0;
            let wcw = (wc.right - wc.left).max(0);
            let wch = (wc.bottom - wc.top).max(0);

            // Target rect in WorkerW client coords (subtract the virtual origin).
            let (tx, ty, tw, th) = (chosen.0 - vsx, chosen.1 - vsy, chosen.2, chosen.3);
            let (mut fx, mut fy, mut fw, mut fh) = (tx, ty, tw, th);
            let mut fallback = false;
            if have_wc && wcw > 0 && wch > 0 {
                // How much of the target actually falls on the WorkerW canvas?
                let vis = ((tx + tw).min(wcw) - tx.max(0)).max(0) as i64
                    * ((ty + th).min(wch) - ty.max(0)).max(0) as i64;
                let area = (tw.max(1) as i64) * (th.max(1) as i64);
                if vis * 2 < area {
                    // Less than half visible → not reachable here. Use the primary.
                    fx = primary.0 - vsx;
                    fy = primary.1 - vsy;
                    fw = primary.2;
                    fh = primary.3;
                    fallback = true;
                }
            }
            // A degenerate size would also vanish — guard that too.
            if fw <= 0 || fh <= 0 {
                fx = 0;
                fy = 0;
                fw = GetSystemMetrics(SM_CXSCREEN);
                fh = GetSystemMetrics(SM_CYSCREEN);
                fallback = true;
            }

            // Diagnostic log — on a multi-monitor problem, ask the reporter to send
            // daemon/monitor-debug.log. Captures exactly what we saw and applied.
            let mut log = String::from("=== BagIdea Office — wallpaper placement (multi-monitor) ===\n");
            log.push_str(&format!("monitors: {} (index 0 = primary)\n", mons.len()));
            for (i, m) in mons.iter().enumerate() {
                log.push_str(&format!(
                    "  [{}] left={} top={} w={} h={} primary={}\n", i, m.0, m.1, m.2, m.3, m.4));
            }
            log.push_str(&format!("chosen index (monitor.txt): {}\n", idx));
            log.push_str(&format!("virtual screen: origin=({},{}) size={}x{}\n", vsx, vsy, vcx, vcy));
            log.push_str(&format!("WorkerW client: have={} size={}x{}\n", have_wc, wcw, wch));
            log.push_str(&format!("target  (WorkerW coords): x={} y={} w={} h={}\n", tx, ty, tw, th));
            log.push_str(&format!("applied (WorkerW coords): x={} y={} w={} h={} fallback_to_primary={}\n", fx, fy, fw, fh, fallback));
            let _ = std::fs::write(root.join("daemon").join("monitor-debug.log"), log);

            MoveWindow(godot, fx, fy, fw, fh, 1);
        }
    }

    /// Find the world's visible top-level window for `pid`, polling up to
    /// `tries`×50ms. Returns 0 if none appears. NOTE: an already-embedded world
    /// window is a WorkerW child (not top-level), so this only ever returns a
    /// FRESH, not-yet-embedded window — exactly what we want after a (re)launch.
    unsafe fn find_world_window(pid: u32, tries: u32) -> HWND {
        let mut find = FindByPid { pid, hwnd: 0 as HWND };
        for _ in 0..tries {
            EnumWindows(Some(find_by_pid_cb), &mut find as *mut FindByPid as _);
            if find.hwnd != 0 as HWND {
                return find.hwnd;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        0 as HWND
    }

    /// Pin a freshly-found world window behind the desktop icons: zero its input
    /// region while it settles, make it a tool window (no taskbar button), drop it
    /// into a fresh WorkerW, and place it on the chosen screen (multi-monitor).
    /// Returns the WorkerW it embedded into. `wait_ready` waits for the world's
    /// first frame at boot; a relaunch skips the long wait (the world is warm).
    unsafe fn pin_world(godot: HWND, root: &std::path::Path, wait_ready: bool) -> HWND {
        SetWindowRgn(godot as _, CreateRectRgn(0, 0, 0, 0), 1);
        ShowWindow(godot, SW_HIDE);
        let ex = GetWindowLongW(godot, GWL_EXSTYLE) as u32;
        SetWindowLongW(godot, GWL_EXSTYLE, (ex | WS_EX_TOOLWINDOW) as i32);
        ShowWindow(godot, SW_SHOW);
        if wait_ready {
            let started = std::time::SystemTime::now() - std::time::Duration::from_secs(5);
            let flag = std::env::temp_dir().join("bagidea_world_ready");
            for _ in 0..120 {
                let fresh = std::fs::metadata(&flag)
                    .and_then(|m| m.modified())
                    .map(|t| t >= started)
                    .unwrap_or(false);
                if fresh {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            std::thread::sleep(std::time::Duration::from_millis(400));
        } else {
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        SetWindowRgn(godot as _, 0 as _, 1);
        let workerw = spawn_workerw();
        SetParent(godot, workerw);
        // Detect how many monitors there really are and tell the daemon, so the
        // UI shows a display picker ONLY on multi-monitor (and lists the right
        // count). Writing monitors.txt also lets the daemon report it on connect.
        let count = enum_monitors().len().max(1);
        let _ = std::fs::write(root.join("daemon").join("monitors.txt"), count.to_string());
        super::post_monitor_count(count);
        // Multi-monitor → place it on the chosen screen (default = primary).
        if count > 1 {
            position_wallpaper(godot, workerw, root);
        }
        workerw
    }

    /// Terminate a world process (and its tree) with no console flash — used to
    /// clear the windowless zombie Godot leaves behind before we relaunch.
    unsafe fn kill_pid(pid: u32) {
        if pid == 0 {
            return;
        }
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        let _ = super::hidden(&mut c).status();
    }

    /// The live world pid (0 if none) — tray hide + exit cleanup read this so they
    /// target the current world even after the supervisor has relaunched it.
    pub fn live_world_pid(fallback: u32) -> u32 {
        let p = WORLD_PID.load(std::sync::atomic::Ordering::SeqCst);
        if p != 0 { p } else { fallback }
    }

    /// Kill the current world on shell exit (belt-and-braces with main's
    /// office_child.kill(): after a relaunch the live world is a different process
    /// that main no longer holds a Child for).
    pub fn kill_world() {
        unsafe { kill_pid(WORLD_PID.load(std::sync::atomic::Ordering::SeqCst)); }
    }

    pub fn attach_wallpaper_when_ready(pid: u32, root: PathBuf, cx: i32, cy: i32, proxy: tao::event_loop::EventLoopProxy<UserEvent>) {
        std::thread::spawn(move || unsafe {
            use std::sync::atomic::Ordering::{Relaxed, SeqCst};
            WORLD_PID.store(pid, SeqCst);
            let godot = find_world_window(pid, 240);
            if godot == 0 as HWND {
                let _ = proxy.send_event(UserEvent::WorldReady);
                return;
            }
            let mut godot = godot;
            let workerw = pin_world(godot, &root, true);
            let _ = proxy.send_event(UserEvent::WorldReady);

            // World supervisor — the permanent fix for "the wallpaper keeps vanishing".
            //
            // Windows DESTROYS + RECREATES the WorkerW behind the desktop icons on many
            // everyday events: changing or slideshow-rotating the wallpaper, a display
            // resolution/DPI/monitor change, an Explorer or DWM restart, lock screen /
            // RDP / fast user-switch, exiting an exclusive-fullscreen game. SetParent put
            // our Godot window into that WorkerW's window TREE (a child for destruction
            // purposes, WS_CHILD style or not), so when Windows tears the old WorkerW
            // down it destroys our window with it — and Godot never repaints, leaving a
            // windowless zombie process. That is the "wallpaper vanished and won't come
            // back until I restart" report. Two recovery paths, checked every 2s:
            //
            //   • window ALIVE but reparented off the WorkerW → re-embed into a fresh one.
            //   • window DESTROYED → adopt whatever fresh window the world put up, or, if
            //     it's a windowless zombie, relaunch the world and re-embed it.
            //
            // CRITICAL — why this doesn't repeat the old Win+D regression (issues #5/#6/#7,
            // reverted twice): the re-embed path gates on PARENT LOSS, never on
            // IsWindowVisible. During Win+D / display sleep the window stays parented to a
            // live WorkerW, so `parent_ok` is true and we touch NOTHING.
            let debug = std::env::var("BAGIDEA_WALLPAPER_DEBUG").is_ok();
            let logpath = root.join("daemon").join("wallpaper-debug.log");
            let dlog = |s: String| {
                if debug {
                    let _ = std::fs::OpenOptions::new().create(true).append(true)
                        .open(&logpath).and_then(|mut f| writeln!(f, "{s}"));
                }
            };
            let mut cur_workerw = workerw;
            let mut orphan_streak = 0u32;
            let mut relaunches: Vec<std::time::Instant> = Vec::new();
            let mut tick = 0u64;
            loop {
                std::thread::sleep(std::time::Duration::from_secs(2));
                tick += 1;
                if super::SHUTTING_DOWN.load(Relaxed) { break; }
                // Owner hid the office from the tray → stand down entirely.
                if WALLPAPER_HIDDEN.load(SeqCst) { orphan_streak = 0; continue; }

                if IsWindow(godot) != 0 {
                    // --- Window ALIVE: keep it embedded (cheap parent-loss re-pin). ---
                    // GetAncestor(GA_PARENT), NOT GetParent: our window is a top-level
                    // window (no WS_CHILD), so GetParent returns its OWNER (null here),
                    // while GetAncestor returns the real SetParent target — WorkerW when
                    // embedded, the desktop (#32769) once Windows tears WorkerW down.
                    let parent = GetAncestor(godot, GA_PARENT);
                    let parent_ok = parent == cur_workerw
                        || (IsWindow(parent) != 0 && is_wallpaper_layer(parent));
                    if parent_ok {
                        orphan_streak = 0;
                    } else {
                        // Debounce: require 2 consecutive misses (~4s) so a transient
                        // reparent race during a display-mode change can't cause churn.
                        orphan_streak += 1;
                        if orphan_streak >= 2 {
                            let fresh = spawn_workerw();
                            if fresh != 0 as HWND {
                                SetParent(godot, fresh);
                                cur_workerw = fresh;
                                if enum_monitors().len() > 1 {
                                    position_wallpaper(godot, fresh, &root);
                                }
                                dlog(format!("[t={tick}] RE-EMBED → workerw={:p}", fresh as *const ()));
                            }
                            orphan_streak = 0;
                        }
                    }
                } else {
                    // --- Window DESTROYED: recover the world. ---
                    orphan_streak = 0;
                    if super::SHUTTING_DOWN.load(Relaxed) { break; }
                    let cur_pid = WORLD_PID.load(SeqCst);
                    // (a) A fresh top-level world window already up (Godot recreated one,
                    // or an earlier relaunch is still booting)? Adopt it.
                    let mut w = find_world_window(cur_pid, 4);
                    if w == 0 as HWND {
                        // (b) Windowless zombie → relaunch. Crash-loop guard: at most 5
                        // relaunches per rolling 60s, else back off so we never spin.
                        let now = std::time::Instant::now();
                        relaunches.retain(|t| now.duration_since(*t) < std::time::Duration::from_secs(60));
                        if relaunches.len() >= 5 {
                            dlog(format!("[t={tick}] relaunch backoff (>=5 in 60s)"));
                            std::thread::sleep(std::time::Duration::from_secs(30));
                            continue;
                        }
                        kill_pid(cur_pid);
                        match super::spawn_office(&root, cx, cy) {
                            Some(child) => {
                                let np = child.id();
                                drop(child); // process runs on; tracked via WORLD_PID
                                WORLD_PID.store(np, SeqCst);
                                relaunches.push(now);
                                dlog(format!("[t={tick}] RELAUNCH world → pid={np}"));
                                w = find_world_window(np, 240);
                            }
                            None => {
                                dlog(format!("[t={tick}] relaunch FAILED (spawn_office None)"));
                                std::thread::sleep(std::time::Duration::from_secs(5));
                                continue;
                            }
                        }
                    }
                    if w != 0 as HWND {
                        godot = w;
                        cur_workerw = pin_world(godot, &root, false);
                        let _ = proxy.send_event(UserEvent::WorldReady);
                        dlog(format!("[t={tick}] RE-PINNED window={:p}", godot as *const ()));
                    }
                }
                if debug {
                    let alive = IsWindow(godot);
                    let vis = if alive != 0 { IsWindowVisible(godot) } else { 0 };
                    let iconic = if alive != 0 { IsIconic(godot) } else { 0 };
                    let parent = if alive != 0 { GetAncestor(godot, GA_PARENT) } else { 0 as HWND };
                    let on_workerw = if parent == cur_workerw { 1 } else { 0 };
                    let mut rc = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                    let _ = GetWindowRect(godot, &mut rc);
                    dlog(format!(
                        "[t={tick}] alive={alive} vis={vis} iconic={iconic} on_workerw={on_workerw} parent={:p} size={}x{} pid={}",
                        parent as *const (), rc.right - rc.left, rc.bottom - rc.top, WORLD_PID.load(SeqCst)));
                }
            }
        });
    }

    pub fn hide_office(pid: u32, hidden: bool) {
        // Tell the re-pin watcher to stand down while the user keeps it hidden.
        WALLPAPER_HIDDEN.store(hidden, std::sync::atomic::Ordering::SeqCst);
        let g = find_wallpaper_hwnd(pid);
        if g != 0 as HWND {
            unsafe { ShowWindow(g, if hidden { SW_HIDE } else { SW_SHOW }); }
        }
    }

    /// Focus an already-open editor by pid; returns true if one was found.
    pub fn focus_pid(pid: u32) -> bool {
        if pid == 0 {
            return false;
        }
        let mut find = FindByPid { pid, hwnd: 0 as HWND };
        unsafe { EnumWindows(Some(find_by_pid_cb), &mut find as *mut FindByPid as _); }
        if find.hwnd != 0 as HWND {
            unsafe {
                use windows_sys::Win32::UI::WindowsAndMessaging::{SetForegroundWindow, ShowWindow, SW_RESTORE};
                ShowWindow(find.hwnd, SW_RESTORE);
                SetForegroundWindow(find.hwnd);
            }
            true
        } else {
            false
        }
    }

    pub fn apply_chrome(b: WindowBuilder) -> WindowBuilder {
        b.with_undecorated_shadow(false).with_skip_taskbar(true)
    }

    pub fn set_no_activate(window: &Window) {
        unsafe {
            let hwnd = window.hwnd() as HWND;
            let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            SetWindowLongW(hwnd, GWL_EXSTYLE, (ex | WS_EX_NOACTIVATE) as i32);
        }
    }

    // Re-assert top-most with NO frame/size/move/activate change — avoids the caption
    // or shadow repaint that the tao always_on_top toggle triggered.
    pub fn raise_topmost(window: &Window) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        unsafe {
            SetWindowPos(window.hwnd() as HWND, HWND_TOPMOST, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }

    // The orb window keeps a hidden caption (despite decorations(false)) that Windows
    // paints behind the orb when it's clicked — a white bar. Changing the window STYLE
    // to drop it made a frame show permanently, so instead subclass the window proc and
    // simply swallow the non-client paint/activate messages: no caption is ever drawn,
    // and every other message still reaches wry's original proc untouched.
    static ORB_PREV_PROC: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
    unsafe extern "system" fn orb_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        use std::sync::atomic::Ordering;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CallWindowProcW, WM_NCACTIVATE, WM_NCCALCSIZE, WM_NCPAINT,
        };
        // Make the ENTIRE window client area — no non-client band at all, so Windows/DWM
        // has nowhere to draw the caption bar, its icon, or the min/close buttons.
        if msg == WM_NCCALCSIZE && wp != 0 { return 0; }
        if msg == WM_NCPAINT { return 0; }            // never paint a caption/frame
        if msg == WM_NCACTIVATE { return 1; }         // keep NC state, no redraw flash
        let prev: isize = ORB_PREV_PROC.load(Ordering::SeqCst);
        let f: windows_sys::Win32::UI::WindowsAndMessaging::WNDPROC = std::mem::transmute(prev);
        CallWindowProcW(f, hwnd, msg, wp, lp)
    }
    pub fn suppress_nc(window: &Window) {
        use std::sync::atomic::Ordering;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowLongPtrW, SetWindowPos, GWL_STYLE, GWLP_WNDPROC, SWP_FRAMECHANGED,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
            WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU,
        };
        unsafe {
            let hwnd = window.hwnd() as HWND;
            // The window (despite decorations(false)) carries WS_SYSMENU + min/max boxes,
            // so DWM draws a system icon and min/max/close buttons in the corners on click.
            // Drop ONLY those bits — keep WS_CAPTION/BORDER/DLGFRAME so the transparent DWM
            // composition is untouched (removing those made a white frame show). The proc
            // below (WM_NCCALCSIZE→0) then removes the caption band itself.
            let st = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            SetWindowLongW(hwnd, GWL_STYLE,
                (st & !(WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)) as i32);
            let prev = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, orb_proc as isize);
            ORB_PREV_PROC.store(prev, Ordering::SeqCst);
            // Force a frame recompute so the style change + WM_NCCALCSIZE take effect.
            SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE);
        }
    }

    pub fn region_round(window: &Window, w: f64, h: f64, radius: f64) {
        let sf = window.scale_factor();
        unsafe {
            // CreateRoundRectRgn takes the ELLIPSE size, not the radius — so the
            // corner it cuts is half of what you pass. Feeding it the CSS radius
            // straight left the window silhouette squarer than the border-radius the
            // page draws, and the opaque nub between the two arcs is what made the
            // corners look mismatched. Double it so region and CSS agree.
            let rgn = CreateRoundRectRgn(
                0, 0,
                (w * sf) as i32 + 1, (h * sf) as i32 + 1,
                (radius * 2.0 * sf) as i32, (radius * 2.0 * sf) as i32,
            );
            SetWindowRgn(window.hwnd() as _, rgn, 1);
        }
    }

    /// 📡 feed mode's ghost-over-your-desktop look, done the only way that actually
    /// produces it on Windows: one uniform alpha over the finished window.
    ///
    /// v0.9.51 moved this into the page (CSS on a per-pixel-transparent window) on the
    /// theory that WS_EX_LAYERED was what wedged the WebView2 host. Measuring the
    /// result killed that idea: on a transparent overlay the page's own layers do NOT
    /// all reach the desktop. The area under the promoted feed list composited at true
    /// alpha while everything else — the 6px gutter, the title bar, the rounded corners
    /// — landed on an opaque backing surface, so the edge lit up as a pale frame, the
    /// header washed out, and the bottom corners grew white fringes. A red-canvas probe
    /// over black and white full-screen backdrops returned the identical pixel both
    /// times, which is the whole story: that surface is not see-through.
    ///
    /// So the alpha comes back, and the overlay is an opaque window again. The freeze
    /// this was removed for was never reproduced in ~30 scripted transitions, the other
    /// two v0.9.51 changes (never flipping `resizable`, clearing the stale size floor)
    /// stay, and tray → "Reload chat window" is there if it ever does come back.
    /// `Some(a)` = layer the window and hold it at that alpha; `None` = fully opaque
    /// and the layered style comes back off. While feed mode is on the style stays
    /// put and only the VALUE moves (hover), so the ex-style is flipped exactly twice
    /// per feed session — the fewer times that happens around a WebView2 host, the
    /// better (see the doc comment above).
    pub fn set_feed_alpha(window: &Window, alpha: Option<u8>) {
        unsafe {
            let hwnd = window.hwnd() as HWND;
            let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            match alpha {
                Some(a) => {
                    if ex & WS_EX_LAYERED == 0 {
                        SetWindowLongW(hwnd, GWL_EXSTYLE, (ex | WS_EX_LAYERED) as i32);
                    }
                    SetLayeredWindowAttributes(hwnd, 0, a, LWA_ALPHA);
                }
                None => {
                    SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
                    SetWindowLongW(hwnd, GWL_EXSTYLE, (ex & !WS_EX_LAYERED) as i32);
                }
            }
        }
    }

    pub fn region_circle(window: &Window, d: f64) {
        // Clip the (square, transparent) window down to its inscribed circle so the
        // corners are not part of the window AT ALL — clicks there fall straight
        // through to whatever is beneath (e.g. desktop icons), and only the visible
        // orb is interactive. Size the ellipse from GetClientRect: that's the exact
        // coordinate space SetWindowRgn uses, so the circle always matches the window
        // (tao's inner_size / scale_factor can disagree with it and crop a crescent).
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetClientRect;
        let hwnd = window.hwnd() as HWND;
        unsafe {
            // The orb window is NOT square (Windows pads it to a min width), and its
            // image is object-fit:contain → centred. So CENTRE the circle in the real
            // client rect: it overlays the visible orb exactly, the side margins become
            // click-through, and any stray title-bar pixels get clipped away too.
            let mut rc: RECT = std::mem::zeroed();
            let ok = GetClientRect(hwnd, &mut rc);
            let (w, h) = if ok != 0 && rc.right - rc.left > 1 {
                (rc.right - rc.left, rc.bottom - rc.top)
            } else {
                let s = (d * window.scale_factor()) as i32; (s, s)   // fallback before layout
            };
            let n = w.min(h);
            let (left, top) = ((w - n) / 2, (h - n) / 2);
            let rgn = CreateEllipticRgn(left, top, left + n + 1, top + n + 1);
            SetWindowRgn(hwnd, rgn, 1);
        }
    }

    pub fn webview_extras<'a>(b: wry::WebViewBuilder<'a>) -> wry::WebViewBuilder<'a> {
        use wry::WebViewBuilderExtWindows;
        // Edge's "Saved info" autofill bubbles are noise on an app UI.
        b.with_general_autofill_enabled(false)
    }

    const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    const RUN_NAME: &str = "BagIdeaOffice";

    pub fn is_autostart() -> bool {
        let mut c = Command::new("reg");
        c.args(["query", RUN_KEY, "/v", RUN_NAME]);
        super::hidden(&mut c).output().map(|o| o.status.success()).unwrap_or(false)
    }

    pub fn set_autostart(on: bool) {
        if on {
            if let Ok(exe) = std::env::current_exe() {
                let mut c = Command::new("reg");
                c.args(["add", RUN_KEY, "/v", RUN_NAME, "/t", "REG_SZ", "/d",
                    &exe.to_string_lossy(), "/f"]);
                let _ = super::hidden(&mut c).status();
            }
        } else {
            let mut c = Command::new("reg");
            c.args(["delete", RUN_KEY, "/v", RUN_NAME, "/f"]);
            let _ = super::hidden(&mut c).status();
        }
    }

    pub fn restore_wallpaper() {
        unsafe {
            SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, std::ptr::null_mut(), 3);
        }
    }

    /// Register the `bagidea://` URL protocol (per-user) so the website's
    // Edit-menu shim is macOS-only (Windows webviews already handle Cmd/Ctrl-C/V).
    pub fn install_edit_menu() {}

    /// "Open in office" Install button launches us with the deep link. Idempotent
    /// — written on every normal startup so it self-heals after a move/reinstall.
    pub fn register_uri_scheme() {
        let exe = match std::env::current_exe() {
            Ok(e) => e.to_string_lossy().into_owned(),
            Err(_) => return,
        };
        let base = r"HKCU\Software\Classes\bagidea";
        let run = |args: &[&str]| {
            let mut c = Command::new("reg");
            c.args(args);
            let _ = super::hidden(&mut c).status();
        };
        run(&["add", base, "/ve", "/t", "REG_SZ", "/d", "URL:BagIdea Office", "/f"]);
        run(&["add", base, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"]);
        let cmd_key = format!(r"{}\shell\open\command", base);
        let cmd_val = format!("\"{}\" \"%1\"", exe);
        run(&["add", &cmd_key, "/ve", "/t", "REG_SZ", "/d", &cmd_val, "/f"]);
    }

    // Scan state for `occl_cb` — an EnumWindows pass that flips `occluded` true
    // the moment any normal window covers the primary monitor.
    struct OcclScan { own_pid: u32, occluded: bool }

    unsafe extern "system" fn occl_cb(h: HWND, lp: windows_sys::Win32::Foundation::LPARAM) -> i32 {
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONULL,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetWindowRect, IsIconic};
        let scan = &mut *(lp as *mut OcclScan);
        // Skip hidden, minimized, and our own (the wallpaper) windows.
        if IsWindowVisible(h) == 0 || IsIconic(h) != 0 {
            return 1;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(h, &mut pid);
        if pid == scan.own_pid {
            return 1;
        }
        // Skip the desktop shell itself (Progman / WorkerW / SHELLDLL_DefView) —
        // those ARE full-screen and would always read as "covered".
        let mut cls = [0u16; 32];
        let n = GetClassNameW(h, cls.as_mut_ptr(), cls.len() as i32);
        let name = String::from_utf16_lossy(&cls[..n.max(0) as usize]);
        if name == "Progman" || name == "WorkerW" || name == "SHELLDLL_DefView" {
            return 1;
        }
        // Only windows on the PRIMARY monitor (where the wallpaper lives) count;
        // a full-screen app on a second monitor leaves the wallpaper visible.
        let mon = MonitorFromWindow(h, MONITOR_DEFAULTTONULL);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(mon, &mut mi) == 0 {
            return 1;
        }
        if mi.dwFlags & 1 == 0 { // 1 = MONITORINFOF_PRIMARY
            return 1;
        }
        let mut wr: RECT = std::mem::zeroed();
        if GetWindowRect(h, &mut wr) == 0 {
            return 1;
        }
        let mw = (mi.rcMonitor.right - mi.rcMonitor.left) as f64;
        let mh = (mi.rcMonitor.bottom - mi.rcMonitor.top) as f64;
        let ww = (wr.right - wr.left) as f64;
        let hh = (wr.bottom - wr.top) as f64;
        // Maximized leaves the taskbar (~4%) uncovered: ≥98% width, ≥88% height.
        if ww >= mw * 0.98 && hh >= mh * 0.88 {
            scan.occluded = true;
            return 0; // found a coverer — stop enumerating
        }
        1
    }

    /// True when ANY normal window — not just the focused one — covers the
    /// primary monitor. Mirrors the macOS CGWindowList scan, so a maximized
    /// window that lost focus to a small floating window still throttles the
    /// wallpaper (a foreground-only check would miss that, wasting CPU).
    pub fn desktop_occluded(_lw: f64, _lh: f64, own_pid: u32) -> bool {
        let mut scan = OcclScan { own_pid, occluded: false };
        unsafe { EnumWindows(Some(occl_cb), &mut scan as *mut OcclScan as _); }
        scan.occluded
    }

    pub const AUTOSTART_LABEL: &str = "Start with Windows";
}

// =====================================================================
//  macOS platform implementation
// =====================================================================
#[cfg(target_os = "macos")]
mod platform {
    use super::UserEvent;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;
    use std::path::PathBuf;
    use std::process::Command;
    use tao::platform::macos::WindowExtMacOS;
    use tao::window::{Window, WindowBuilder};

    pub const AUTOSTART_LABEL: &str = "Start at login";

    pub fn godot_exe(root: &PathBuf) -> String {
        let app = root.join("godot").join("bin-mac").join("Godot.app")
            .join("Contents").join("MacOS").join("Godot");
        if app.exists() {
            return app.to_string_lossy().into_owned();
        }
        std::env::var("BAGIDEA_GODOT")
            .unwrap_or_else(|_| "/Applications/Godot.app/Contents/MacOS/Godot".into())
    }

    pub fn office_args(c: &mut Command, root: &PathBuf, _cx: i32, _cy: i32) {
        // Stage A: a normal windowed office (the desktop-level embed comes from
        // the DYLD shim in a follow-up). Still passes --wallpaper so the world
        // reports ready the same way.
        c.args(["--path"]).arg(root.join("godot")).args(["--", "--wallpaper"]);
        // If a built shim is present, inject it so Godot drops to desktop level.
        let shim = root.join("shell").join("macos").join("libwallpaper_shim.dylib");
        if shim.exists() {
            c.env("DYLD_INSERT_LIBRARIES", shim);
        }
    }

    pub fn ensure_single_instance() -> bool {
        let lock = std::env::temp_dir().join("bagidea_office_shell.lock");
        if let Ok(s) = std::fs::read_to_string(&lock) {
            if let Ok(pid) = s.trim().parse::<i32>() {
                let alive = Command::new("kill")
                    .args(["-0", &pid.to_string()])
                    .status()
                    .map(|st| st.success())
                    .unwrap_or(false);
                if alive {
                    return false;
                }
            }
        }
        let _ = std::fs::write(&lock, std::process::id().to_string());
        true
    }

    // No global hotkey yet on macOS (needs a Carbon RegisterEventHotKey or a
    // CGEventTap with Accessibility permission). The in-overlay mic button still
    // works; this is a no-op until that lands.
    pub fn spawn_hotkey_thread(_proxy: tao::event_loop::EventLoopProxy<UserEvent>) {}
    pub fn rebind_hotkey(_s: &str) {}

    /// Background monitor: writes /tmp/bagidea_occ when the wallpaper is
    /// invisible so Godot throttles to 2 fps and stops wasting GPU.
    ///
    /// Two conditions signal invisibility, both judged on the display the
    /// wallpaper is actually on rather than on the primary one:
    ///   1. That display asleep (lid closed / display off) — CGDisplayIsAsleep.
    ///   2. An ORDINARY window (layer >= 0, so never the desktop or the icon
    ///      layer) with alpha >= 0.1 covers >= 90 % of that display — a
    ///      fullscreen app, a screensaver, or any maximised window filling it.
    ///      System chrome that covers the screen without hiding it (the Dock,
    ///      matched by bundle id) does not count.
    ///
    /// Uses CGWindowListCopyWindowInfo via toll-free-bridged NSArray/NSDictionary
    /// so we can use msg_send! without adding extra crates.
    ///
    /// `office_pid` is the world (Godot) process, used to find which display the
    /// wallpaper is on. Pass 0 to fall back to the main display.
    pub fn spawn_occlusion_monitor(office_pid: u32) {
        use std::ffi::c_void;

        #[repr(C)] struct OccPoint  { x: f64, y: f64 }
        #[repr(C)] struct OccSize   { w: f64, h: f64 }
        #[repr(C)] struct OccRect   { origin: OccPoint, size: OccSize }

        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGMainDisplayID() -> u32;
            fn CGDisplayIsAsleep(d: u32) -> u32;
            fn CGDisplayBounds(d: u32) -> OccRect;
            fn CGGetActiveDisplayList(max: u32, list: *mut u32, count: *mut u32) -> i32;
            fn CGWindowListCopyWindowInfo(opt: u32, rel: u32) -> *mut AnyObject;
        }
        #[link(name = "CoreFoundation", kind = "framework")]
        extern "C" { fn CFRelease(cf: *const c_void); }

        const OCC_FLAG: &str = "/private/tmp/bagidea_occ";
        const ON_SCREEN_ONLY: u32 = 1;
        const NULL_WINDOW:    u32 = 0;
        const MAX_DISPLAYS:   u32 = 8;

        std::thread::spawn(move || {
            // Require 2 consecutive "covered" readings before writing the flag.
            // This debounces 1-poll transients (notification banners, system HUDs,
            // brief Window Server overlays) that appear for <2 s and aren't real
            // occlusion. Display-sleep is exempt: it triggers on the first reading.
            let mut streak: u32 = 0;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(1000));

                // Background threads don't get an autorelease pool from the runtime.
                // Drain once per loop so autoreleased NSString/CFType objects are
                // freed every second instead of accumulating for the life of the process.
                let pool: *mut AnyObject = unsafe { msg_send![class!(NSAutoreleasePool), new] };

                let covered_now = unsafe {
                    let list: *mut AnyObject =
                        CGWindowListCopyWindowInfo(ON_SCREEN_ONLY, NULL_WINDOW);
                    if list.is_null() {
                        // No window list, so no way to tell which display the world
                        // is on — but sleep is the one condition that should never
                        // need one. Fall back to the main display for it rather than
                        // reporting "visible" while the machine is dark.
                        CGDisplayIsAsleep(CGMainDisplayID()) != 0
                    } else {
                        let count: usize = msg_send![list, count];
                        let mut found = false;

                        // Hoist dictionary keys outside the per-window loops so they
                        // are created once per poll, not once per window.
                        let lk: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: b"kCGWindowLayer\0".as_ptr()];
                        let ak: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: b"kCGWindowAlpha\0".as_ptr()];
                        let pk: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: b"kCGWindowOwnerPID\0".as_ptr()];
                        let bk: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: b"kCGWindowBounds\0".as_ptr()];
                        let xk: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: b"X\0".as_ptr()];
                        let yk: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: b"Y\0".as_ptr()];
                        let wk: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: b"Width\0".as_ptr()];
                        let hk: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: b"Height\0".as_ptr()];

                        // Judge occlusion on the display the wallpaper is ACTUALLY on,
                        // not on CGMainDisplayID(). With a second monitor the world
                        // frequently lives on the secondary display, where a fullscreen
                        // app on the primary hides nothing — checking the primary pins a
                        // wallpaper that is in plain sight at 2 fps, which is exactly how
                        // this reads to the user: the agents crawl while the desktop they
                        // are drawn on is fully visible.
                        //
                        // Locate the world's own desktop-level window by pid, then take
                        // the active display it overlaps most. Falls back to the main
                        // display when the window is not up yet (early boot) or the pid
                        // is unknown, which reproduces the previous behaviour.
                        let display = {
                            let (mut wx, mut wy, mut ww, mut wh) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
                            let mut got = false;
                            for i in 0..count {
                                let dict: *mut AnyObject = msg_send![list, objectAtIndex: i];
                                if dict.is_null() { continue; }
                                let pn: *mut AnyObject = msg_send![dict, objectForKey: pk];
                                if pn.is_null() { continue; }
                                let owner_pid: u32 = msg_send![pn, unsignedIntValue];
                                if office_pid == 0 || owner_pid != office_pid { continue; }
                                // The world sits at the desktop level (deeply negative);
                                // ignore any ordinary window the same process may own.
                                let ln: *mut AnyObject = msg_send![dict, objectForKey: lk];
                                if ln.is_null() { continue; }
                                let layer: i64 = msg_send![ln, longLongValue];
                                if layer >= 0 { continue; }
                                let bd: *mut AnyObject = msg_send![dict, objectForKey: bk];
                                if bd.is_null() { continue; }
                                let xn: *mut AnyObject = msg_send![bd, objectForKey: xk];
                                let yn: *mut AnyObject = msg_send![bd, objectForKey: yk];
                                let wn: *mut AnyObject = msg_send![bd, objectForKey: wk];
                                let hn: *mut AnyObject = msg_send![bd, objectForKey: hk];
                                if wn.is_null() || hn.is_null() { continue; }
                                let x: f64 = if xn.is_null() { 0.0 } else { msg_send![xn, doubleValue] };
                                let y: f64 = if yn.is_null() { 0.0 } else { msg_send![yn, doubleValue] };
                                let w: f64 = msg_send![wn, doubleValue];
                                let h: f64 = msg_send![hn, doubleValue];
                                wx = x; wy = y; ww = w; wh = h;
                                got = true;
                                break;
                            }

                            let mut chosen = CGMainDisplayID();
                            if got {
                                let mut ids = [0u32; MAX_DISPLAYS as usize];
                                let mut n: u32 = 0;
                                if CGGetActiveDisplayList(MAX_DISPLAYS, ids.as_mut_ptr(), &mut n) == 0 {
                                    let mut best = 0.0f64;
                                    for k in 0..(n as usize).min(MAX_DISPLAYS as usize) {
                                        let db: OccRect = CGDisplayBounds(ids[k]);
                                        let ix = ((db.origin.x + db.size.w).min(wx + ww)
                                            - db.origin.x.max(wx)).max(0.0);
                                        let iy = ((db.origin.y + db.size.h).min(wy + wh)
                                            - db.origin.y.max(wy)).max(0.0);
                                        let area = ix * iy;
                                        if area > best { best = area; chosen = ids[k]; }
                                    }
                                }
                            }
                            chosen
                        };

                        if CGDisplayIsAsleep(display) != 0 {
                            CFRelease(list as *const c_void);
                            true
                        } else {
                            let screen: OccRect = CGDisplayBounds(display);

                            for i in 0..count {
                                let dict: *mut AnyObject = msg_send![list, objectAtIndex: i];
                                if dict.is_null() { continue; }

                                // Layer check: only count NORMAL app windows (layer >= 0).
                                // This excludes Finder's desktop-icon layer (–2147483603),
                                // which is always full-screen but doesn't hide the wallpaper
                                // from the user's perspective.
                                let ln: *mut AnyObject = msg_send![dict, objectForKey: lk];
                                if ln.is_null() { continue; }
                                let layer: i64 = msg_send![ln, longLongValue];
                                if layer < 0 { continue; } // skip desktop / icon / system layers

                                // Alpha check: skip transparent/invisible windows.
                                // macOS Notification Center posts a full-screen transparent
                                // overlay (alpha ≈ 0) alongside the visible banner; without
                                // this filter it triggers the 90% coverage check even though
                                // the wallpaper is still visible underneath.
                                let an: *mut AnyObject = msg_send![dict, objectForKey: ak];
                                if !an.is_null() {
                                    let alpha: f64 = msg_send![an, doubleValue];
                                    if alpha < 0.1 { continue; }
                                }

                                // Owner check: skip known system chrome that covers the screen
                                // but doesn't hide content — the Dock owns a full-screen opaque
                                // window (layer 20, alpha 1.0, cov 100%); this is not a real
                                // occlusion.
                                //
                                // Identify it by BUNDLE ID, not by kCGWindowOwnerName: that key
                                // carries the *localized* process name, so matching the literal
                                // "Dock" silently fails on every non-English system (it reads
                                // "程序坞" on a Chinese one). When the match fails, the Dock's
                                // own window counts as an app covering 100 % of the screen, so
                                // the flag is written on every poll and the wallpaper is pinned
                                // at 2 fps forever, whatever is actually on screen.
                                let pn: *mut AnyObject = msg_send![dict, objectForKey: pk];
                                if !pn.is_null() {
                                    let pid: i32 = msg_send![pn, intValue];
                                    let app: *mut AnyObject = msg_send![
                                        class!(NSRunningApplication),
                                        runningApplicationWithProcessIdentifier: pid
                                    ];
                                    if !app.is_null() {
                                        let bid: *mut AnyObject = msg_send![app, bundleIdentifier];
                                        if !bid.is_null() {
                                            let b_ptr: *const i8 = msg_send![bid, UTF8String];
                                            if !b_ptr.is_null()
                                                && std::ffi::CStr::from_ptr(b_ptr).to_bytes()
                                                    == b"com.apple.dock"
                                            {
                                                continue;
                                            }
                                        }
                                    }
                                }

                                // Bounds check — does this window cover the primary screen?
                                let bd: *mut AnyObject = msg_send![dict, objectForKey: bk];
                                if bd.is_null() { continue; }

                                let xn: *mut AnyObject = msg_send![bd, objectForKey: xk];
                                let yn: *mut AnyObject = msg_send![bd, objectForKey: yk];
                                let wn: *mut AnyObject = msg_send![bd, objectForKey: wk];
                                let hn: *mut AnyObject = msg_send![bd, objectForKey: hk];
                                if wn.is_null() || hn.is_null() { continue; }
                                let x: f64 = if xn.is_null() { 0.0 } else { msg_send![xn, doubleValue] };
                                let y: f64 = if yn.is_null() { 0.0 } else { msg_send![yn, doubleValue] };
                                let w: f64 = msg_send![wn, doubleValue];
                                let h: f64 = msg_send![hn, doubleValue];

                                // 2-D intersection with the primary screen — correctly handles
                                // monitors on left (x<0), right (x≥screen.w), above, below, or
                                // any mix in 3-monitor setups. Coverage = intersection area /
                                // primary-screen area; threshold 90% ≈ the old 95%×95% check.
                                let px0 = screen.origin.x; let px1 = px0 + screen.size.w;
                                let py0 = screen.origin.y; let py1 = py0 + screen.size.h;
                                let ix = (px1.min(x + w) - px0.max(x)).max(0.0);
                                let iy = (py1.min(y + h) - py0.max(y)).max(0.0);
                                let coverage = (ix * iy) / (screen.size.w * screen.size.h);
                                if coverage >= 0.90 {
                                    found = true;
                                    break;
                                }
                            }

                            // CFArrayRef from CGWindowListCopyWindowInfo has +1 retain
                            // (Create-rule): must release when done.
                            CFRelease(list as *const c_void);
                            found
                        }
                    }
                };

                if covered_now {
                    streak = streak.saturating_add(1);
                } else {
                    streak = 0;
                    let _ = std::fs::remove_file(OCC_FLAG);
                }
                // Write flag only after 2 consecutive covered readings (~2 s).
                // Display-sleep is detected immediately (CGDisplayIsAsleep returns true
                // in the very first poll where it fires), so it also gets streak≥2 fast
                // if the user keeps the lid closed; transient 1-poll blips don't.
                if streak >= 2 {
                    let _ = std::fs::write(OCC_FLAG, b"1");
                }

                unsafe { let () = msg_send![pool, drain]; }
            } // end loop
        }); // end thread
    }

    // The shim handles the desktop-level embed; here we just wait for the world
    // to report ready (or a timeout) and lift the splash.
    pub fn live_world_pid(fallback: u32) -> u32 { fallback }
    pub fn kill_world() {}

    pub fn attach_wallpaper_when_ready(_pid: u32, _root: PathBuf, _cx: i32, _cy: i32, proxy: tao::event_loop::EventLoopProxy<UserEvent>) {
        std::thread::spawn(move || {
            let started = std::time::SystemTime::now() - std::time::Duration::from_secs(2);
            let flag = std::env::temp_dir().join("bagidea_world_ready");
            for _ in 0..30 {
                let fresh = std::fs::metadata(&flag)
                    .and_then(|m| m.modified())
                    .map(|t| t >= started)
                    .unwrap_or(false);
                if fresh {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
            }
            let _ = proxy.send_event(UserEvent::WorldReady);
        });
    }

    fn running_app(pid: u32) -> *mut AnyObject {
        unsafe {
            let cls = class!(NSRunningApplication);
            msg_send![cls, runningApplicationWithProcessIdentifier: pid as i32]
        }
    }

    pub fn hide_office(pid: u32, hidden: bool) {
        let app = running_app(pid);
        if app.is_null() {
            return;
        }
        unsafe {
            if hidden {
                let _: bool = msg_send![app, hide];
            } else {
                let _: bool = msg_send![app, unhide];
            }
        }
    }

    pub fn focus_pid(pid: u32) -> bool {
        if pid == 0 {
            return false;
        }
        let app = running_app(pid);
        if app.is_null() {
            return false;
        }
        unsafe {
            // NSApplicationActivateIgnoringOtherApps = 1 << 1
            let _: bool = msg_send![app, activateWithOptions: 2u64];
        }
        true
    }

    pub fn apply_chrome(b: WindowBuilder) -> WindowBuilder {
        b
    }

    pub fn set_no_activate(_window: &Window) {}
    pub fn raise_topmost(window: &Window) { window.set_always_on_top(false); window.set_always_on_top(true); }
    pub fn suppress_nc(_window: &Window) {}

    fn round_corners(window: &Window, radius: f64) {
        unsafe {
            let w = window.ns_window() as *mut AnyObject;
            if w.is_null() {
                return;
            }
            let _: () = msg_send![w, setOpaque: false];
            let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
            let _: () = msg_send![w, setBackgroundColor: clear];
            let view: *mut AnyObject = msg_send![w, contentView];
            if view.is_null() {
                return;
            }
            let _: () = msg_send![view, setWantsLayer: true];
            let layer: *mut AnyObject = msg_send![view, layer];
            if !layer.is_null() {
                let _: () = msg_send![layer, setCornerRadius: radius];
                let _: () = msg_send![layer, setMasksToBounds: true];
            }
        }
    }

    pub fn region_round(window: &Window, _w: f64, _h: f64, radius: f64) {
        round_corners(window, radius);
    }

    pub fn region_circle(window: &Window, d: f64) {
        round_corners(window, d / 2.0);
    }

    /// 📡 feed translucency — the window's own alpha, same scale as Windows' 0-255.
    pub fn set_feed_alpha(window: &Window, alpha: Option<u8>) {
        unsafe {
            let w = window.ns_window() as *mut AnyObject;
            if !w.is_null() {
                let a: f64 = alpha.map(|a| a as f64 / 255.0).unwrap_or(1.0);
                let _: () = msg_send![w, setAlphaValue: a];
            }
        }
    }

    pub fn webview_extras<'a>(b: wry::WebViewBuilder<'a>) -> wry::WebViewBuilder<'a> {
        b
    }

    fn plist_path() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        PathBuf::from(home).join("Library").join("LaunchAgents")
            .join("com.bagidea.office.plist")
    }

    pub fn is_autostart() -> bool {
        plist_path().exists()
    }

    pub fn set_autostart(on: bool) {
        let p = plist_path();
        if on {
            if let Ok(exe) = std::env::current_exe() {
                let _ = std::fs::create_dir_all(p.parent().unwrap());
                let body = format!(
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
<plist version=\"1.0\"><dict>\n\
  <key>Label</key><string>com.bagidea.office</string>\n\
  <key>ProgramArguments</key><array><string>{}</string></array>\n\
  <key>RunAtLoad</key><true/>\n\
</dict></plist>\n",
                    exe.to_string_lossy()
                );
                let _ = std::fs::write(&p, body);
            }
        } else {
            let _ = std::fs::remove_file(&p);
        }
    }

    pub fn restore_wallpaper() {}

    // macOS deep-link registration is declared in the app bundle's Info.plist
    // (CFBundleURLTypes), not at runtime — so this is a no-op here.
    pub fn register_uri_scheme() {}

    // wry's frameless macOS window has no app menu, so the default Cmd-C/V/X/A/Z key
    // equivalents (AppKit routes these through the Edit menu) never fire — copy/paste
    // looks broken in every text field. Install a minimal main menu with a standard Edit
    // submenu; the items have NO target, so AppKit dispatches each action to the first
    // responder (the focused webview field). Fixes issue #8.
    pub fn install_edit_menu() {
        use objc2::runtime::Sel;
        unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let main_menu: *mut AnyObject = msg_send![class!(NSMenu), new];
            let app_item: *mut AnyObject = msg_send![class!(NSMenuItem), new];
            let _: () = msg_send![main_menu, addItem: app_item];

            let edit_title = NSString::from_str("Edit");
            let edit_item: *mut AnyObject = msg_send![class!(NSMenuItem), new];
            let edit_menu: *mut AnyObject = msg_send![class!(NSMenu), alloc];
            let edit_menu: *mut AnyObject = msg_send![edit_menu, initWithTitle: &*edit_title];

            let add = |menu: *mut AnyObject, title: &str, action: Sel, key: &str| unsafe {
                let t = NSString::from_str(title);
                let k = NSString::from_str(key);
                let item: *mut AnyObject = msg_send![class!(NSMenuItem), alloc];
                let item: *mut AnyObject =
                    msg_send![item, initWithTitle: &*t, action: action, keyEquivalent: &*k];
                let _: () = msg_send![menu, addItem: item];
            };
            add(edit_menu, "Undo", objc2::sel!(undo:), "z");
            add(edit_menu, "Redo", objc2::sel!(redo:), "Z");
            add(edit_menu, "Cut", objc2::sel!(cut:), "x");
            add(edit_menu, "Copy", objc2::sel!(copy:), "c");
            add(edit_menu, "Paste", objc2::sel!(paste:), "v");
            add(edit_menu, "Select All", objc2::sel!(selectAll:), "a");

            let _: () = msg_send![edit_item, setSubmenu: edit_menu];
            let _: () = msg_send![main_menu, addItem: edit_item];
            let _: () = msg_send![app, setMainMenu: main_menu];
        }
    }

    /// True when a foreground app window (nearly) covers the whole screen, so
    /// the wallpaper is invisible and the renderer can crawl. Considers only
    /// layer-0 windows (skips the menu bar, Dock, and our desktop-level Godot
    /// embed) and ignores windows owned by `own_pid` (the wallpaper itself).
    /// `lw`/`lh` are the screen size in points — CGWindow bounds are in points.
    pub fn desktop_occluded(lw: f64, lh: f64, own_pid: u32) -> bool {
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGWindowListCopyWindowInfo(option: u32, relative: u32) -> *mut AnyObject;
            static kCGWindowBounds: *const AnyObject;
            static kCGWindowLayer: *const AnyObject;
            static kCGWindowOwnerPID: *const AnyObject;
        }
        // kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements
        const OPTS: u32 = (1 << 0) | (1 << 4);
        unsafe {
            let list = CGWindowListCopyWindowInfo(OPTS, 0);
            if list.is_null() {
                return false;
            }
            let x_key = NSString::from_str("X");
            let y_key = NSString::from_str("Y");
            let w_key = NSString::from_str("Width");
            let h_key = NSString::from_str("Height");
            let count: usize = msg_send![list, count];
            let mut occluded = false;
            for i in 0..count {
                let win: *mut AnyObject = msg_send![list, objectAtIndex: i];
                let layer_n: *mut AnyObject = msg_send![win, objectForKey: kCGWindowLayer];
                if layer_n.is_null() {
                    continue;
                }
                let layer: i64 = msg_send![layer_n, longLongValue];
                if layer != 0 {
                    continue; // menu bar / Dock / desktop-level embed
                }
                let pid_n: *mut AnyObject = msg_send![win, objectForKey: kCGWindowOwnerPID];
                if !pid_n.is_null() {
                    let pid: i64 = msg_send![pid_n, longLongValue];
                    if pid as u32 == own_pid {
                        continue; // the wallpaper window itself
                    }
                }
                let bounds: *mut AnyObject = msg_send![win, objectForKey: kCGWindowBounds];
                if bounds.is_null() {
                    continue;
                }
                let xn: *mut AnyObject = msg_send![bounds, objectForKey: &*x_key];
                let yn: *mut AnyObject = msg_send![bounds, objectForKey: &*y_key];
                let wn: *mut AnyObject = msg_send![bounds, objectForKey: &*w_key];
                let hn: *mut AnyObject = msg_send![bounds, objectForKey: &*h_key];
                if xn.is_null() || yn.is_null() || wn.is_null() || hn.is_null() {
                    continue;
                }
                let wx: f64 = msg_send![xn, doubleValue];
                let wy: f64 = msg_send![yn, doubleValue];
                let ww: f64 = msg_send![wn, doubleValue];
                let hh: f64 = msg_send![hn, doubleValue];
                // The primary monitor always contains the origin (0,0); a window
                // on a secondary monitor has X or Y far from it. Only occlude when
                // the coverer sits on the primary (where the wallpaper lives).
                if wx.abs() > lw * 0.5 || wy.abs() > lh * 0.5 {
                    continue;
                }
                // A maximized window leaves the menu bar (~3%) and possibly the
                // Dock uncovered, so ≥98% width and ≥88% height counts as covered.
                if ww >= lw * 0.98 && hh >= lh * 0.88 {
                    occluded = true;
                    break;
                }
            }
            let _: () = msg_send![list, release];
            occluded
        }
    }
}

// =====================================================================
//  Fallback platform stub (other unixes) — keeps the crate compiling.
// =====================================================================
#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::UserEvent;
    use std::path::PathBuf;
    use std::process::Command;
    use tao::window::{Window, WindowBuilder};

    pub const AUTOSTART_LABEL: &str = "Start at login";
    pub fn godot_exe(_root: &PathBuf) -> String {
        std::env::var("BAGIDEA_GODOT").unwrap_or_else(|_| "godot".into())
    }
    pub fn office_args(c: &mut Command, root: &PathBuf, _cx: i32, _cy: i32) {
        c.args(["--path"]).arg(root.join("godot")).args(["--", "--wallpaper"]);
    }
    pub fn ensure_single_instance() -> bool { true }
    pub fn spawn_hotkey_thread(_p: tao::event_loop::EventLoopProxy<UserEvent>) {}
    pub fn rebind_hotkey(_s: &str) {}
    pub fn live_world_pid(fallback: u32) -> u32 { fallback }
    pub fn kill_world() {}

    pub fn attach_wallpaper_when_ready(pid: u32, _root: PathBuf, _cx: i32, _cy: i32, proxy: tao::event_loop::EventLoopProxy<UserEvent>) {
        std::thread::spawn(move || {
            // Wait for Godot's first real frame (it writes this file), like Windows/macOS.
            let ready = std::env::temp_dir().join("bagidea_world_ready");
            let start = std::time::Instant::now();
            while !ready.exists() && start.elapsed().as_secs() < 15 {
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            std::thread::sleep(std::time::Duration::from_millis(400));
            // X11/Xwayland: push the Godot window to the desktop layer (below everything,
            // on all workspaces, off the taskbar). Best-effort — if the tools are absent
            // or the session is pure Wayland, it simply stays a fullscreen window (the
            // accepted fallback). Godot already sizes itself to the screen in --wallpaper.
            attach_to_desktop(pid);
            let _ = proxy.send_event(UserEvent::WorldReady);
        });
    }
    // X11 window ids owned by a process (needs `xdotool`).
    fn windows_for_pid(pid: u32) -> Vec<String> {
        let p = pid.to_string();
        match Command::new("xdotool").args(["search", "--pid", p.as_str()]).output() {
            Ok(o) if o.status.success() =>
                String::from_utf8_lossy(&o.stdout).split_whitespace().map(|s| s.to_string()).collect(),
            _ => Vec::new(),
        }
    }
    fn attach_to_desktop(pid: u32) {
        // The window may not be mapped the instant world_ready appears — retry briefly.
        let mut ids: Vec<String> = Vec::new();
        for _ in 0..25 {
            ids = windows_for_pid(pid);
            if !ids.is_empty() { break; }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        for id in &ids {
            // wmctrl accepts at most TWO state properties per -b call → split them.
            let _ = Command::new("wmctrl")
                .args(["-i", "-r", id.as_str(), "-b", "add,below,sticky"]).status();
            let _ = Command::new("wmctrl")
                .args(["-i", "-r", id.as_str(), "-b", "add,skip_taskbar,skip_pager"]).status();
            // Bonus: mark it a desktop-type window where the WM honours it (truer wallpaper).
            let _ = Command::new("xprop").args([
                "-id", id.as_str(), "-f", "_NET_WM_WINDOW_TYPE", "32a",
                "-set", "_NET_WM_WINDOW_TYPE", "_NET_WM_WINDOW_TYPE_DESKTOP"]).status();
        }
    }
    pub fn hide_office(pid: u32, hidden: bool) {
        let action = if hidden { "windowunmap" } else { "windowmap" };
        for id in windows_for_pid(pid) {
            let _ = Command::new("xdotool").args([action, id.as_str()]).status();
        }
    }
    pub fn focus_pid(_pid: u32) -> bool { false }
    pub fn apply_chrome(b: WindowBuilder) -> WindowBuilder { b }
    pub fn set_no_activate(_w: &Window) {}
    pub fn raise_topmost(window: &Window) { window.set_always_on_top(false); window.set_always_on_top(true); }
    pub fn suppress_nc(_w: &Window) {}
    pub fn region_round(_w: &Window, _a: f64, _b: f64, _r: f64) {}
    pub fn region_circle(_w: &Window, _d: f64) {}
    pub fn set_feed_alpha(_w: &Window, _a: Option<u8>) {}
    pub fn webview_extras<'a>(b: wry::WebViewBuilder<'a>) -> wry::WebViewBuilder<'a> { b }
    pub fn is_autostart() -> bool { false }
    pub fn set_autostart(_on: bool) {}
    pub fn restore_wallpaper() {}
    pub fn register_uri_scheme() {}
    pub fn install_edit_menu() {}
    pub fn desktop_occluded(_lw: f64, _lh: f64, _own_pid: u32) -> bool { false }
}

// --------------------------------------------------------------------- helpers
/// Build one of the frameless chrome windows (splash / overlay / orb).
fn chrome_window(
    el: &tao::event_loop::EventLoop<UserEvent>,
    title: &str,
    w: f64,
    h: f64,
    x: f64,
    y: f64,
    icon: Option<Icon>,
    transparent: bool,
    resizable: bool,
) -> Window {
    let mut b = WindowBuilder::new()
        .with_title(title)
        .with_inner_size(LogicalSize::new(w, h))
        .with_position(LogicalPosition::new(x, y))
        .with_decorations(false)
        .with_resizable(resizable)
        .with_always_on_top(true);
    // Per-pixel alpha so a rounded/circular shape comes from the page's anti-aliased
    // CSS border-radius — NOT a hard-edged SetWindowRgn clip (which looks jagged).
    if transparent {
        b = b.with_transparent(true);
    }
    if let Some(ic) = icon {
        b = b.with_window_icon(Some(ic));
    }
    b = platform::apply_chrome(b);
    b.build(el).expect("window")
}

// --------------------------------------------------------------------- main
// Hand a `bagidea://install?repo=<url>` deep link to the running office over the
// daemon's localhost port. We don't install here — the daemon broadcasts an
// intent and the office UI asks the user to confirm. Returns true if delivered.
fn forward_deep_link(url: &str) -> bool {
    use std::io::{Read, Write};
    let rest = url.trim_start_matches("bagidea://");
    // only the install intent is supported
    let repo = match rest.split_once("repo=") {
        Some((_, r)) => percent_decode(r.split('&').next().unwrap_or("")),
        None => return false,
    };
    if repo.is_empty() {
        return false;
    }
    let body = format!("{{\"repo\":{}}}", json_quote(&repo));
    let req = format!(
        "POST /plugins/intent HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n\
         x-bagidea-ui: 1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    match std::net::TcpStream::connect(("127.0.0.1", 8787)) {
        Ok(mut s) => {
            let _ = s.set_write_timeout(Some(std::time::Duration::from_secs(2)));
            if s.write_all(req.as_bytes()).is_err() {
                return false;
            }
            let _ = s.flush();
            // read a little so the daemon finishes handling before we drop
            let _ = s.set_read_timeout(Some(std::time::Duration::from_millis(700)));
            let mut buf = [0u8; 64];
            let _ = s.read(&mut buf);
            true
        }
        Err(_) => false,
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 3 <= b.len() => match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                Ok(v) => { out.push(v); i += 3; }
                Err(_) => { out.push(b'%'); i += 1; }
            },
            b'+' => { out.push(b' '); i += 1; }
            c => { out.push(c); i += 1; }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn json_quote(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => {}
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn main() {
    // bagidea:// deep link (the website's "Open in office" Install button)?
    // Hand it to the running office — which asks the user to confirm before
    // installing — then exit. If the office isn't up, the forward fails and we
    // fall through to a normal launch (the office opens; click Install again).
    if let Some(url) = std::env::args().skip(1).find(|a| a.starts_with("bagidea://")) {
        if forward_deep_link(&url) {
            return;
        }
    }

    // Single instance: a second launch exits immediately.
    if !platform::ensure_single_instance() {
        return;
    }
    // Make the website's one-click install reach us (idempotent; self-heals).
    platform::register_uri_scheme();

    // ---- Unix signal handlers: SIGTERM/SIGINT → clean shutdown
    // Without this, `kill <shell-pid>` or `launchctl unload` kills the shell
    // but leaves the node daemon and Godot as orphans on PID 1.
    #[cfg(unix)]
    {
        use std::os::raw::c_int;
        extern "C" fn handle_signal(_sig: c_int) {
            SIGNAL_SHUTDOWN.store(true, Ordering::Relaxed);
        }
        unsafe {
            libc::signal(libc::SIGTERM, handle_signal as usize);
            libc::signal(libc::SIGINT, handle_signal as usize);
        }
    }

    use wry::WebViewBuilder;

    // ---- boot the whole stack
    let root = project_root();
    let mut daemon_child = spawn_daemon(&root);
    if daemon_child.is_some() {
        std::thread::sleep(std::time::Duration::from_millis(800));
    }

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    // macOS: give the frameless app a standard Edit menu so Cmd-C/V/X/A/Z work in text
    // fields (no-op elsewhere). Without it copy/paste is dead on macOS — issue #8.
    platform::install_edit_menu();

    let (phys_w, phys_h) = event_loop
        .primary_monitor()
        .map(|m| (m.size().width as i32, m.size().height as i32))
        .unwrap_or((1920, 1080));
    let (world_cx, world_cy) = (phys_w / 2, phys_h / 2 - 30);
    let mut office_child = spawn_office(&root, world_cx, world_cy);
    if let Some(child) = office_child.as_ref() {
        // Pass the spawn geometry so the supervisor can relaunch the world itself
        // if Windows destroys its window (WorkerW teardown) — see the thread body.
        platform::attach_wallpaper_when_ready(child.id(), root.clone(), world_cx, world_cy, proxy.clone());
    }

    let _ = std::fs::write(std::env::temp_dir().join("bagidea_shell_alive"), "1");
    watch_editor_requests(proxy.clone());

    // ---- daemon watchdog: the office must never sit there brainless.
    // If the daemon ever dies (a crash, an OOM, a `bagidea` kill that reached
    // the daemon but not us), bring it straight back. Cheap: a 400ms TCP probe
    // every 5s, and spawn_daemon is a no-op while it's already up. Stops the
    // moment the user quits so we don't fight a deliberate shutdown.
    {
        let root = root.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            if SHUTTING_DOWN.load(Ordering::Relaxed) {
                break;
            }
            if !daemon_running() && !SHUTTING_DOWN.load(Ordering::Relaxed) {
                let _ = spawn_daemon(&root);
            }
        });
    }

    // ---- system tray: the only true exit
    let tray_menu = Menu::new();
    let open_item = MenuItem::new("Open Office Chat", true, None);
    // Two hide levels — the office keeps WORKING under both; only visibility changes:
    //   hide_item     = everything gone (wallpaper + chat + chat-head)
    //   hidechat_item = chat + chat-head gone, wallpaper stays alive
    let hide_item = CheckMenuItem::new("Hide everything (agents keep working)", true, false, None);
    let hidechat_item = CheckMenuItem::new("Hide chat + button (wallpaper stays)", true, false, None);
    // First aid before the sledgehammer: reloading the page brings a wedged chat
    // window back WITHOUT touching the daemon, so nobody's agent loses its run.
    let reload_item = MenuItem::new("Reload chat window", true, None);
    let restart_item = MenuItem::new("Restart office", true, None);
    let autostart_item = CheckMenuItem::new(platform::AUTOSTART_LABEL, true, platform::is_autostart(), None);
    let exit_item = MenuItem::new("Exit BagIdea Office", true, None);
    let _ = tray_menu.append_items(&[
        &open_item,
        &hide_item,
        &hidechat_item,
        &reload_item,
        &restart_item,
        &autostart_item,
        &PredefinedMenuItem::separator(),
        &exit_item,
    ]);
    let _tray = TrayIconBuilder::new()
        .with_menu(Box::new(tray_menu))
        .with_tooltip("BagIdea Office")
        .with_icon(tray_app_icon().expect("tray icon"))
        .build()
        .expect("tray");
    let open_id = open_item.id().clone();
    let hide_id = hide_item.id().clone();
    let hidechat_id = hidechat_item.id().clone();
    let reload_id = reload_item.id().clone();
    let restart_id = restart_item.id().clone();
    let autostart_id = autostart_item.id().clone();
    let exit_id = exit_item.id().clone();

    platform::spawn_hotkey_thread(event_loop.create_proxy());

    let office_pid = office_child.as_ref().map(|c| c.id()).unwrap_or(0);

    // macOS only: poll CGWindowList for full-screen windows / display sleep
    // and write /tmp/bagidea_occ so Godot throttles to 2 fps when invisible.
    // The pid lets the monitor judge occlusion on the display the wallpaper is
    // actually on rather than always on the primary one.
    #[cfg(target_os = "macos")]
    if office_child.is_some() {
        platform::spawn_occlusion_monitor(office_pid);
    }

    // ---- screen-aware default positions
    let (screen_w, screen_h, sf) = event_loop
        .primary_monitor()
        .map(|m| (m.size().width as f64, m.size().height as f64, m.scale_factor()))
        .unwrap_or((1920.0, 1080.0, 1.0));
    let logical_w = screen_w / sf;
    let logical_h = screen_h / sf;
    let orb_x = logical_w - ORB_SIZE * 2.0;
    let orb_y = ORB_SIZE;
    let overlay_x = (logical_w - FULL.0 - ORB_SIZE * 2.2).max(20.0);
    let overlay_y = 90.0;
    let feed_h = (logical_h * 0.5).clamp(320.0, 560.0);
    let feed_x = logical_w - FEED_W - 8.0;
    let feed_y = logical_h - feed_h - 64.0;

    // ---- boot splash: a pulsing circular logo, centered
    let splash = chrome_window(
        &event_loop, "BagIdea", SPLASH_SIZE, SPLASH_SIZE,
        (logical_w - SPLASH_SIZE) / 2.0, (logical_h - SPLASH_SIZE) / 2.0 - 30.0, None, true, false,
    );
    platform::set_no_activate(&splash);
    let _splash_view = WebViewBuilder::new()
        .with_transparent(true)
        .with_html(splash_html())
        .build(&splash)
        .expect("splash webview");
    let _splash_id = splash.id();

    // ---- overlay (born visible but parked off-screen)
    // BORN RESIZABLE and never flipped back. The mode toggles used to restyle this
    // window's frame (WS_THICKFRAME on for ⛶ large, off again on the way out) —
    // restyling the frame of a live WebView2 host is not a supported thing to do,
    // and it sat right in the path where a window came back from large/feed DEAD:
    // drawing its last frame forever while the window resized underneath it.
    // Never reproduced on demand, so this is removing a hazard rather than a proven
    // cause. Nothing is lost by staying resizable: the webview covers the whole
    // frameless window, so the OS resize handles are unreachable and large mode's
    // JS edge strips remain the only way to drag an edge.
    // OPAQUE — unlike the orb and the splash, which are small shaped windows whose
    // whole surface the page paints. A full WebView2 host does not honour per-pixel
    // alpha across all of its layers (see set_feed_alpha): the promoted feed list
    // reached the desktop, the gutter, the header and the rounded corners landed on
    // an opaque backing and read as a pale frame. 📡 feed's see-through is the
    // window's own alpha instead, which covers every pixel equally.
    let overlay = chrome_window(
        &event_loop, "BagIdea Office", FULL.0, FULL.1, PARK.0, PARK.1, app_icon(), false, true,
    );
    overlay.set_outer_position(LogicalPosition::new(PARK.0, PARK.1));
    let overlay_id = overlay.id();
    let p_overlay = proxy.clone();
    // If the daemon cannot be reached, say so IN the window instead of showing an
    // empty one. Waiting first, generously: a slow boot must not be reported as
    // a blocked machine.
    let daemon_reachable = wait_for_daemon(std::time::Duration::from_secs(25));
    let overlay_view = platform::webview_extras(
        (if daemon_reachable {
            WebViewBuilder::new().with_url("http://127.0.0.1:8787/")
        } else {
            WebViewBuilder::new().with_html(OFFLINE_HTML)
        })
            .with_devtools(true)
            .with_ipc_handler(move |req| {
                let _ = match req.body().as_str() {
                    "drag-overlay" => p_overlay.send_event(UserEvent::DragOverlay),
                    "hide" => p_overlay.send_event(UserEvent::HideOverlay),
                    "mini" => p_overlay.send_event(UserEvent::MiniToggle),
                    "large" => p_overlay.send_event(UserEvent::LargeToggle),
                    "feed-hover:1" => p_overlay.send_event(UserEvent::FeedHover(true)),
                    "feed-hover:0" => p_overlay.send_event(UserEvent::FeedHover(false)),
                    s if s.starts_with("resize:") =>
                        p_overlay.send_event(UserEvent::ResizeDrag(s[7..].to_string())),
                    s if s.starts_with("hotkey:") =>
                        p_overlay.send_event(UserEvent::SetHotkey(s[7..].to_string())),
                    s if s.starts_with("open-window:") =>
                        p_overlay.send_event(UserEvent::OpenWindow(s[12..].to_string())),
                    _ => Ok(()),
                };
            }))
        .build(&overlay)
        .expect("overlay webview");
    platform::region_round(&overlay, FULL.0, FULL.1, 18.0);
    // Browser-chat mode (Linux/ARM64): the embedded overlay paints blank here, and a
    // mapped-but-blank window just shows as the grey panel. Hide it for good — "Open
    // chat" routes to the system browser instead — so neither the blank panel nor a
    // useless overlay is ever shown. (Safe to hide because we never re-show it in this
    // mode; the v0.9.31 re-show bug was about mapping it again, which we don't do.)
    if browser_chat() {
        overlay.set_visible(false);
    }

    // ---- circular chat head
    let orb = chrome_window(
        &event_loop, "BagIdea", ORB_SIZE, ORB_SIZE, orb_x, orb_y, app_icon(), true, false,
    );
    platform::set_no_activate(&orb);
    platform::suppress_nc(&orb);   // swallow non-client paint → no white caption bar on click
    let orb_id = orb.id();
    let p_orb = proxy.clone();
    let _orb_view = WebViewBuilder::new()
        .with_transparent(true)
        .with_html(orb_html())
        .with_ipc_handler(move |req| {
            let _ = match req.body().as_str() {
                "toggle" => p_orb.send_event(UserEvent::Toggle),
                "drag-orb" => p_orb.send_event(UserEvent::DragOrb),
                "mode" => p_orb.send_event(UserEvent::FeedToggle),
                _ => Ok(()),
            };
        })
        .build(&orb)
        .expect("orb webview");
    orb.set_outer_position(LogicalPosition::new(PARK.0, PARK.1 + 200.0));
    // Browser-chat mode: the orb is an always-on-top click target — on X11 it gets
    // clamped on-screen and becomes an invisible click-stealer over the desktop/apps.
    // Hide it (and skip showing it on WorldReady below) so only the tray + browser run.
    if browser_chat() {
        orb.set_visible(false);
    }

    // Re-assert the orb on top WITHOUT churning its frame. The old false→true
    // always_on_top toggle issued frame-changing SetWindowPos calls, which flashed the
    // window's caption/shadow (a white bar behind the orb) on every click.
    let raise_orb = |orb: &Window| {
        platform::raise_topmost(orb);
    };

    // Pop-out windows (plugin panels / media viewers) opened on demand from the
    // overlay. Held here so their Window + WebView stay alive; dropped on close.
    // Tuple: (window id, single-instance key, window, webview).
    let mut popups: Vec<(tao::window::WindowId, String, Window, wry::WebView)> = Vec::new();
    let mut mini = false;
    let mut feed = false;
    let mut large = false;
    let mut editor_pid: u32 = 0;
    let mut editor_child: Option<Child> = None; // reaped on reopen → kills the PID-recycling focus bug
    let mut world_ready = false;
    // Tracks whether the wallpaper is believed visible (30 fps) vs throttled
    // (2 fps). Driven by the manual "Hide office" tray item AND auto-occlusion.
    let mut vis_on = true;
    let mut last_watch = std::time::Instant::now();
    let mut last_alive = std::time::Instant::now();
    event_loop.run(move |event, target, control_flow| {
        // Unix signal (SIGTERM/SIGINT) → same cleanup as tray Exit.
        if SIGNAL_SHUTDOWN.load(Ordering::Relaxed) {
            SHUTTING_DOWN.store(true, Ordering::Relaxed);
            if let Some(c) = daemon_child.as_mut() {
                let _ = c.kill();
            }
            if let Some(c) = office_child.as_mut() {
                let _ = c.kill();
            }
            platform::kill_world(); // in case the supervisor relaunched the world
            *control_flow = ControlFlow::Exit;
            return;
        }

        // A slow poll tick keeps the tray channels live without pinning a core.
        *control_flow = ControlFlow::WaitUntil(
            std::time::Instant::now() + std::time::Duration::from_millis(250),
        );
        // Freshness heartbeat: the daemon trusts bagidea_shell_alive only while
        // its mtime is recent — a crash leaves a STALE flag, and the daemon's
        // own editor-launch fallback takes over instead of waiting forever on a
        // shell that isn't there. (The flag used to be written once at boot.)
        if last_alive.elapsed().as_secs() >= 5 {
            last_alive = std::time::Instant::now();
            let _ = std::fs::write(std::env::temp_dir().join("bagidea_shell_alive"), "1");
        }
        // Chat-head watchdog — THROTTLED. Re-asserting window state every tick
        // pins a CPU core on macOS (each level/visibility poke wakes the loop),
        // so we only check every ~2s and only touch the window when the orb has
        // genuinely drifted off-screen after the world is up.
        if world_ready && !hide_item.is_checked() && !hidechat_item.is_checked()
            && last_watch.elapsed().as_millis() >= 2000
        {
            last_watch = std::time::Instant::now();
            let off = orb.outer_position().map(|p| p.x < -2000).unwrap_or(false);
            if off {
                orb.set_outer_position(LogicalPosition::new(orb_x, orb_y));
                orb.set_visible(true);
                raise_orb(&orb);
            }
            // NOTE: the auto-occlusion throttle (desktop_occluded → 2 fps when a
            // window covers the wallpaper) is DISABLED. It mis-fired and pinned
            // the renderer at 2 fps (stutter + idle GPU). The detector functions
            // are kept for a future, properly-tested revisit; for now only the
            // manual tray "Hide office" toggle throttles.
        }

        let mut shutdown = false;
        let mut toggle = false;

        while let Ok(ev) = MenuEvent::receiver().try_recv() {
            if ev.id == exit_id {
                shutdown = true;
            } else if ev.id == open_id {
                toggle = true;
            } else if ev.id == hide_id {
                let hidden = hide_item.is_checked();
                // The supervisor may have relaunched the world → target the LIVE pid.
                platform::hide_office(platform::live_world_pid(office_pid), hidden);
                if hidden {
                    overlay.set_outer_position(LogicalPosition::new(PARK.0, PARK.1));
                    orb.set_outer_position(LogicalPosition::new(PARK.0, PARK.1 + 200.0));
                } else if !hidechat_item.is_checked() {
                    // Don't resurrect the orb if the chat-only hide still wants it gone.
                    orb.set_outer_position(LogicalPosition::new(orb_x, orb_y));
                    raise_orb(&orb);
                }
                vis_on = !hidden;
                post_visibility(!hidden);
            } else if ev.id == hidechat_id {
                // Level 2: chat + chat-head vanish, the wallpaper world keeps
                // rendering (and the office keeps working either way).
                if hidechat_item.is_checked() {
                    overlay.set_outer_position(LogicalPosition::new(PARK.0, PARK.1));
                    orb.set_outer_position(LogicalPosition::new(PARK.0, PARK.1 + 200.0));
                } else if !hide_item.is_checked() {
                    orb.set_outer_position(LogicalPosition::new(orb_x, orb_y));
                    raise_orb(&orb);
                }
            } else if ev.id == reload_id {
                // Re-navigate rather than reload(): a fresh document is built even if
                // the current one is the thing that got stuck. A fresh page has no mode
                // classes, so put the WINDOW back to the plain one as well — otherwise
                // the shell would still think it is in feed/large while the page no
                // longer is. Rescue lands you in the normal window, on screen, in front.
                feed = false;
                large = false;
                mini = false;
                overlay.set_min_inner_size(None::<LogicalSize<f64>>);
                overlay.set_inner_size(LogicalSize::new(FULL.0, FULL.1));
                overlay.set_outer_position(LogicalPosition::new(overlay_x, overlay_y));
                platform::region_round(&overlay, FULL.0, FULL.1, 18.0);
                platform::set_feed_alpha(&overlay, None);
                let _ = overlay.set_ignore_cursor_events(false);
                let _ = overlay_view.load_url("http://127.0.0.1:8787/");
                overlay.set_focus();
                raise_orb(&orb);
            } else if ev.id == restart_id {
                // The daemon does a detached relaunch that outlives us being killed.
                post_restart();
            } else if ev.id == autostart_id {
                platform::set_autostart(autostart_item.is_checked());
            }
        }

        while let Ok(ev) = TrayIconEvent::receiver().try_recv() {
            if let TrayIconEvent::Click { button: tray_icon::MouseButton::Left, button_state: tray_icon::MouseButtonState::Up, .. } = ev {
                toggle = true;
            }
        }

        let do_toggle = |feed_now: bool, large_now: bool| {
            // Browser-chat mode (Linux/ARM64): the embedded overlay is blank here,
            // so open/focus the chat in an external browser instead of toggling it.
            if browser_chat() {
                open_chat_browser();
                let _ = (feed_now, large_now);
                return;
            }
            let hidden = overlay
                .outer_position()
                .map(|p| p.x < -2000)
                .unwrap_or(true);
            if hidden {
                let (px, py) = if large_now {
                    // Large keeps whatever size the user stretched it to — re-center that.
                    let s = overlay.inner_size().to_logical::<f64>(overlay.scale_factor());
                    (((logical_w - s.width) / 2.0).max(0.0), (((logical_h - s.height) / 2.0) - 20.0).max(10.0))
                } else if feed_now { (feed_x, feed_y) } else { (overlay_x, overlay_y) };
                overlay.set_outer_position(LogicalPosition::new(px, py));
                overlay.set_focus();
                raise_orb(&orb);
            } else {
                overlay.set_outer_position(LogicalPosition::new(PARK.0, PARK.1));
            }
            let _ = &overlay_view;
        };

        if toggle {
            do_toggle(feed, large);
        }

        match event {
            Event::WindowEvent { window_id, event: WindowEvent::CloseRequested, .. } => {
                if window_id == overlay_id {
                    overlay.set_outer_position(LogicalPosition::new(PARK.0, PARK.1));
                } else {
                    // A pop-out window's native ✕ — drop it (frees Window + WebView).
                    popups.retain(|(id, _, _, _)| *id != window_id);
                }
            }
            Event::WindowEvent { window_id, event: WindowEvent::Focused(true), .. } => {
                if window_id == overlay_id {
                    raise_orb(&orb);
                }
            }
            Event::WindowEvent { window_id, event: WindowEvent::Resized(_), .. } => {
                if window_id == overlay_id {
                    // Large is free-resizable — clip to the ACTUAL size, not a mode
                    // constant, or the rounded region crops the stretched window.
                    let (w, h) = if large {
                        let s = overlay.inner_size().to_logical::<f64>(overlay.scale_factor());
                        (s.width, s.height)
                    } else if feed { (FEED_W, feed_h) } else if mini { MINI } else { FULL };
                    // Fullscreen large = square corners (rounded ones would nick the
                    // screen edges); anything smaller keeps the house radius.
                    let r = if feed { 18.0 }
                        else if large && w >= logical_w - 2.0 && h >= logical_h - 2.0 { 0.0 }
                        else { 18.0 };
                    platform::region_round(&overlay, w, h, r);
                } else if window_id == orb_id {
                    // Re-clip the orb to its circle on any DPI / monitor change so the
                    // transparent corners keep falling through to the desktop.
                    platform::region_circle(&orb, ORB_SIZE);
                }
            }
            Event::UserEvent(ue) => match ue {
                UserEvent::WorldReady => {
                    world_ready = true;
                    splash.set_visible(false);
                    // Browser-chat mode keeps the orb hidden — skip placing/raising it so
                    // it can't be clamped on-screen as an invisible always-on-top target.
                    if !browser_chat() {
                        orb.set_outer_position(LogicalPosition::new(orb_x, orb_y));
                        raise_orb(&orb);
                        // Orb is now shown at its real spot with DPI settled — clip it to a
                        // circle so its transparent corners are click-through to the desktop.
                        platform::region_circle(&orb, ORB_SIZE);
                    }
                }
                UserEvent::EditorOpening => {
                    // PID-recycling guard: if our last editor child has exited, forget
                    // its pid — else focus_pid() may "focus" whatever unrelated process
                    // Windows handed that number to, and the editor never opens again.
                    if let Some(c) = editor_child.as_mut() {
                        if c.try_wait().ok().flatten().is_some() {
                            editor_pid = 0;
                            editor_child = None;
                        }
                    }
                    if editor_pid != 0 && platform::focus_pid(editor_pid) {
                        let _ = std::fs::write(std::env::temp_dir().join("bagidea_editor_ready"), "focused");
                    } else {
                        editor_pid = 0;
                        splash.set_visible(true);
                        splash.set_always_on_top(true);
                        if let Some(child) = spawn_editor(&root, phys_w / 2, phys_h / 2 - 30) {
                            editor_pid = child.id();
                            editor_child = Some(child);
                        } else {
                            // No Godot exe found → resolve the handshake NOW instead of
                            // leaving the splash hanging for the 60s watcher timeout.
                            eprintln!("[shell] editor: godot exe not found (see BAGIDEA_GODOT)");
                            let _ = std::fs::write(std::env::temp_dir().join("bagidea_editor_ready"), "no-exe");
                            splash.set_visible(false);
                        }
                    }
                }
                UserEvent::EditorReady => {
                    splash.set_visible(false);
                }
                UserEvent::Toggle => do_toggle(feed, large),
                UserEvent::HideOverlay => {
                    overlay.set_outer_position(LogicalPosition::new(PARK.0, PARK.1));
                }
                UserEvent::MiniToggle => {
                    if !feed && !large {
                        mini = !mini;
                        let (w, h) = if mini { MINI } else { FULL };
                        overlay.set_inner_size(LogicalSize::new(w, h));
                        platform::region_round(&overlay, w, h, 18.0);
                        raise_orb(&orb);
                    }
                }
                UserEvent::LargeToggle => {
                    if !feed {
                        large = !large;
                        if large {
                            mini = false;
                            // Owner's call: large OPENS FULLSCREEN — whoever wants it
                            // smaller drags an edge down (never below FULL, the floor).
                            // (The window is always resizable — see the overlay's
                            // construction; only the size floor moves with the mode.)
                            overlay.set_min_inner_size(Some(LogicalSize::new(FULL.0, FULL.1)));
                            overlay.set_inner_size(LogicalSize::new(logical_w, logical_h));
                            overlay.set_outer_position(LogicalPosition::new(0.0, 0.0));
                            overlay.set_focus();
                            // Resized fires next and clips the region to the real size.
                        } else {
                            // Drop the large-mode floor first: mini (390×430) and the
                            // feed strip (330 wide) are both below it, and a stale
                            // minimum silently clamps whatever comes next.
                            overlay.set_min_inner_size(None::<LogicalSize<f64>>);
                            overlay.set_inner_size(LogicalSize::new(FULL.0, FULL.1));
                            overlay.set_outer_position(LogicalPosition::new(overlay_x, overlay_y));
                            platform::region_round(&overlay, FULL.0, FULL.1, 18.0);
                        }
                        let _ = overlay_view.evaluate_script(&format!(
                            "window.setLargeMode && setLargeMode({})", large));
                        raise_orb(&orb);
                    }
                }
                UserEvent::ResizeDrag(d) => {
                    if large {
                        use tao::window::ResizeDirection as RD;
                        let dir = match d.as_str() {
                            "n" => RD::North, "s" => RD::South, "e" => RD::East, "w" => RD::West,
                            "ne" => RD::NorthEast, "nw" => RD::NorthWest, "sw" => RD::SouthWest,
                            _ => RD::SouthEast,
                        };
                        let _ = overlay.drag_resize_window(dir);
                    }
                }
                UserEvent::FeedToggle => {
                    if large {
                        // Feed replaces large — drop the FULL size floor before
                        // shrinking to a 330px strip.
                        large = false;
                        overlay.set_min_inner_size(None::<LogicalSize<f64>>);
                        let _ = overlay_view.evaluate_script("window.setLargeMode && setLargeMode(false)");
                    }
                    feed = !feed;
                    let _ = overlay_view.evaluate_script(&format!(
                        "window.setFeedMode && setFeedMode({})", feed));
                    let _ = overlay.set_ignore_cursor_events(false);
                    // Feed translucency is an OS window alpha again — see the note on
                    // set_feed_alpha for why the CSS version had to be given up.
                    // Enter at the resting alpha: the page re-reports hover on its own
                    // if the pointer happens to already be over the strip.
                    platform::set_feed_alpha(&overlay, if feed { Some(FEED_ALPHA) } else { None });
                    if feed {
                        overlay.set_inner_size(LogicalSize::new(FEED_W, feed_h));
                        overlay.set_outer_position(LogicalPosition::new(feed_x, feed_y));
                        platform::region_round(&overlay, FEED_W, feed_h, 18.0);
                    } else {
                        let (w, h) = if mini { MINI } else { FULL };
                        overlay.set_inner_size(LogicalSize::new(w, h));
                        overlay.set_outer_position(LogicalPosition::new(overlay_x, overlay_y));
                        platform::region_round(&overlay, w, h, 18.0);
                    }
                    raise_orb(&orb);
                }
                UserEvent::FeedHover(over) => {
                    // Only meaningful in feed mode — chat and large are opaque, and a
                    // stale hover report must never leave the window half-faded.
                    if feed {
                        platform::set_feed_alpha(
                            &overlay,
                            Some(if over { FEED_ALPHA_READ } else { FEED_ALPHA }),
                        );
                    }
                }
                UserEvent::DragOrb => { let _ = orb.drag_window(); }
                UserEvent::DragOverlay => { let _ = overlay.drag_window(); }
                UserEvent::PttKey(pressed) => {
                    // True hold-to-talk: key DOWN starts recording, key UP sends.
                    // (The low-level hook fires once per physical press/release.)
                    if pressed {
                        let hidden = overlay
                            .outer_position()
                            .map(|p| p.x < -2000)
                            .unwrap_or(true);
                        if hidden {
                            let (px, py) = if large {
                                let s = overlay.inner_size().to_logical::<f64>(overlay.scale_factor());
                                (((logical_w - s.width) / 2.0).max(0.0), (((logical_h - s.height) / 2.0) - 20.0).max(10.0))
                            } else if feed {
                                (feed_x, feed_y)
                            } else {
                                (overlay_x, overlay_y)
                            };
                            overlay.set_outer_position(LogicalPosition::new(px, py));
                            raise_orb(&orb);
                        }
                        let _ = overlay_view.evaluate_script("window.pttSet && pttSet(true)");
                        ptt_beacon("down");
                    } else {
                        let _ = overlay_view.evaluate_script("window.pttSet && pttSet(false)");
                        ptt_beacon("up");
                    }
                }
                UserEvent::SetHotkey(s) => platform::rebind_hotkey(&s),
                UserEvent::OpenWindow(u) => {
                    // u: "/win?src=...&w=900&h=680&resizable=1&key=<id>". Custom
                    // chrome (frameless) so it matches the app + survives streaming.
                    let qval = |name: &str| -> Option<String> {
                        u.split('?').nth(1)?.split('&').find_map(|kv| {
                            let mut it = kv.splitn(2, '=');
                            if it.next()? == name { Some(it.next().unwrap_or("").to_string()) } else { None }
                        })
                    };
                    let key = qval("key").unwrap_or_default();
                    // Single-instance per plugin: already open → surface it, never duplicate.
                    let existing = if key.is_empty() { None }
                        else { popups.iter().position(|(_, k, _, _)| *k == key) };
                    if let Some(ix) = existing {
                        let win = &popups[ix].2;
                        win.set_minimized(false);
                        win.set_visible(true);
                        win.set_focus();
                    } else {
                        let w = qval("w").and_then(|s| s.parse::<f64>().ok()).unwrap_or(900.0);
                        let h = qval("h").and_then(|s| s.parse::<f64>().ok()).unwrap_or(680.0);
                        let resizable = qval("resizable").map(|s| s != "0").unwrap_or(true);
                        let full = if u.starts_with("http") { u.clone() }
                            else { format!("http://127.0.0.1:8787{}", u) };
                        let win = WindowBuilder::new()
                            .with_title("BagIdea Office")
                            .with_inner_size(LogicalSize::new(w, h))
                            .with_min_inner_size(LogicalSize::new(260.0, 180.0))
                            .with_decorations(false)
                            .with_resizable(resizable)
                            .with_window_icon(app_icon())
                            .build(target)
                            .expect("popup window");
                        let id = win.id();
                        // Center on the primary monitor — otherwise the OS scatters
                        // popups to inconsistent spots each time.
                        if let Some(m) = win.primary_monitor() {
                            let ms = m.size();
                            let mp = m.position();
                            let ws = win.outer_size();
                            let cx = mp.x + ((ms.width as i32 - ws.width as i32) / 2).max(0);
                            let cy = mp.y + ((ms.height as i32 - ws.height as i32) / 2).max(0);
                            win.set_outer_position(tao::dpi::PhysicalPosition::new(cx, cy));
                        }
                        let pproxy = proxy.clone();
                        match platform::webview_extras(
                            WebViewBuilder::new()
                                .with_url(&full)
                                .with_ipc_handler(move |req| {
                                    let _ = match req.body().as_str() {
                                        "win-drag" => pproxy.send_event(UserEvent::PopupDrag(id)),
                                        "win-close" => pproxy.send_event(UserEvent::PopupClose(id)),
                                        "win-min" => pproxy.send_event(UserEvent::PopupMin(id)),
                                        "win-max" => pproxy.send_event(UserEvent::PopupMax(id)),
                                        _ => Ok(()),
                                    };
                                }))
                            .build(&win)
                        {
                            Ok(view) => popups.push((id, key, win, view)),
                            Err(e) => eprintln!("[shell] popup webview: {e}"),
                        }
                    }
                }
                UserEvent::PopupDrag(id) => {
                    if let Some((_, _, win, _)) = popups.iter().find(|(i, _, _, _)| *i == id) {
                        let _ = win.drag_window();
                    }
                }
                UserEvent::PopupClose(id) => {
                    popups.retain(|(i, _, _, _)| *i != id);
                }
                UserEvent::PopupMin(id) => {
                    if let Some((_, _, win, _)) = popups.iter().find(|(i, _, _, _)| *i == id) {
                        win.set_minimized(true);
                    }
                }
                UserEvent::PopupMax(id) => {
                    if let Some((_, _, win, _)) = popups.iter().find(|(i, _, _, _)| *i == id) {
                        win.set_maximized(!win.is_maximized());
                    }
                }
            },
            _ => {}
        }

        if shutdown {
            // Tell the watchdog to stand down BEFORE we kill the daemon, or it
            // would dutifully resurrect the very process we're shutting down.
            SHUTTING_DOWN.store(true, Ordering::Relaxed);
            if let Some(c) = office_child.as_mut() {
                let _ = c.kill();
            }
            platform::kill_world(); // in case the supervisor relaunched the world
            if let Some(c) = daemon_child.as_mut() {
                let _ = c.kill();
            }
            platform::restore_wallpaper();
            *control_flow = ControlFlow::Exit;
        }
    });
}
