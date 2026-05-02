# Minerva Desktop App — Development Guide & Next Steps

## Running Release and Dev Side-by-Side

Yes, you can run both. They're different binaries:
- **Release**: installed via `.deb`/`.msi`/`.dmg` to system paths
- **Dev**: runs from source via `npm run tauri dev`

They share the same keychain entry (`com.minervacoach.desktop`) so auth
tokens carry over. They also share the same Tauri app identifier
(`com.minervacoach.desktop`), so only one can run at a time.

To test auto-updates:
1. Install the v0.1.0 release build
2. Bump version in `tauri.conf.json` and `Cargo.toml` to `0.2.0`
3. Push a new tag (`desktop-v0.2.0`) → CI builds and publishes
4. Launch the installed v0.1.0 → it should detect and offer the update

## Architecture Overview

```
desktop_app/
├── src-tauri/src/
│   ├── lib.rs              — Entry point, plugin registration, window setup
│   ├── auth.rs             — Localhost OAuth callback + keychain storage
│   ├── commands.rs         — Tauri IPC commands (api_request proxy, show/hide)
│   ├── process_detector.rs — Zoom meeting detection (per-platform)
│   ├── presence.rs         — Heartbeat to backend during meetings
│   └── socket_proxy.rs     — SocketIO via Rust (bypasses webview TLS)
├── src/
│   ├── App.tsx             — Routes panel vs overlay by window label
│   ├── hooks/
│   │   ├── use-auth.ts           — Token from keychain + auth events
│   │   ├── use-socket.ts         — Listens for Tauri events from socket_proxy
│   │   ├── use-meeting-status.ts — meeting-started/stopped + window visibility
│   │   └── use-connected-accounts.ts — Fetches platform connection status
│   └── components/
│       ├── PanelWindow.tsx        — Main UI (auth gate → accounts → invite → gauges)
│       └── OverlayWindow.tsx      — Transparent floating coaching icons
└── src-tauri/tauri.conf.json  — Window config, updater, CSP, bundle targets
```

## Key Constraints

### Window Operations (All Platforms)
- NEVER call `.show()`/`.hide()` from Rust background threads
- Frontend handles visibility via Tauri events + `invoke("show_windows")`
- `setIgnoreCursorEvents` must not be called on hidden windows (panics on Linux)

### TLS / API Requests
- All HTTP goes through Rust `api_request` command (reqwest, accepts self-signed in debug)
- All SocketIO goes through Rust `socket_proxy.rs` (rust_socketio, same TLS handling)
- The webview's fetch/XHR CANNOT reach self-signed HTTPS backends

### Meeting Detection
- Detection is platform-specific via `#[cfg(target_os = "...")]` blocks
- Only the matching platform's code compiles into the binary
- Detection runs every 5 seconds in a background async task

## Windows Development Setup

### Prerequisites
```powershell
# Install Rust
winget install Rustlang.Rustup

# Install Node.js 20+
winget install OpenJS.NodeJS.LTS

# Install Visual Studio Build Tools (C++ workload required for Tauri)
winget install Microsoft.VisualStudio.2022.BuildTools
# In VS Installer: select "Desktop development with C++"

# Install WebView2 (usually pre-installed on Windows 10/11)
# https://developer.microsoft.com/en-us/microsoft-edge/webview2/
```

### Clone and Run
```powershell
git clone https://github.com/Minerva-Coach/MinervaMVP.git
cd MinervaMVP/desktop_app
npm install
npm run tauri dev
```

### Environment
- API URL defaults to `https://127.0.0.1:8000` in debug, `https://minervacoach.com` in release
- Override with: `$env:MINERVA_API_URL="https://minervacoach.com"; npm run tauri dev`

## Windows Meeting Detection — TODO

**File:** `src-tauri/src/process_detector.rs`

Current state: returns `true` for any running Zoom (no active meeting check).

```rust
#[cfg(target_os = "windows")]
{
    // TODO: Implement Windows meeting detection
    true
}
```

### Implementation Plan

Use the `windows` crate to enumerate windows and check titles:

```rust
// Add to Cargo.toml:
// [target.'cfg(windows)'.dependencies]
// windows = { version = "0.58", features = ["Win32_UI_WindowsAndMessaging", "Win32_Foundation"] }

#[cfg(target_os = "windows")]
fn is_in_active_meeting_windows() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    };
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use std::sync::atomic::{AtomicBool, Ordering};

    // Strategy: same as Linux — check Zoom window titles
    // 1. Find Zoom.exe process IDs
    // 2. Enumerate visible windows belonging to those PIDs
    // 3. Check if any title matches meeting indicators
    //    (not "Zoom Workplace", not "Zoom", etc.)
    //
    // Key Windows API calls:
    // - EnumWindows: iterate all top-level windows
    // - GetWindowThreadProcessId: get PID for a window handle
    // - GetWindowTextW: get window title
    // - IsWindowVisible: skip hidden windows
    //
    // The same MEETING_WINDOW_TITLES and IDLE_WINDOW_TITLES constants
    // should work — Zoom uses similar titles across platforms.
    // Test on Windows to confirm exact title strings.

    todo!("Implement Windows meeting detection")
}
```

### Testing on Windows
1. Open Zoom (idle in tray) → app should NOT detect a meeting
2. Join a meeting → app should detect and show windows
3. Leave meeting → app should hide windows
4. Check window titles: `powershell -c "Get-Process zoom | ForEach-Object { $_.MainWindowTitle }"`
5. Use Spy++ (from VS) or `winspy` for detailed window enumeration

### Meeting URL Extraction on Windows
```rust
// Windows command line is available via:
// - WMI: `wmic process where "name='Zoom.exe'" get CommandLine`
// - PowerShell: `(Get-CimInstance Win32_Process -Filter "name='Zoom.exe'").CommandLine`
// Parse confno= the same way as Linux
```

## macOS Meeting Detection — TODO

**Current state:** Uses `osascript` to get window titles. Needs testing.

```rust
#[cfg(target_os = "macos")]
fn is_in_active_meeting_macos() -> bool {
    // Uses osascript to query System Events for zoom.us window names
    // Already implemented — needs testing on actual macOS with Zoom
}
```

### Testing on macOS
1. Run `npm run tauri dev` with Zoom open
2. Check logs for window title detection
3. Verify titles match `MEETING_WINDOW_TITLES` / `IDLE_WINDOW_TITLES`
4. macOS may use different titles (e.g., "Zoom Meeting" instead of "Meeting")
5. Use: `osascript -e 'tell application "System Events" to tell process "zoom.us" to get name of every window'`

## Do not "fix" the `$schema` URL in `tauri.conf.json`

The correct value is `https://schema.tauri.app/config/2` (Tauri v2 official
schema endpoint). AI assistants — including Claude — have a known habit of
rewriting this line to a hallucinated URL like
`https://raw.githubusercontent.com/nicegram/nicegram-app/.../node_modules/@anthropic-ai/sdk/node_modules/@tauri-apps/cli/config.schema.json`,
which 404s. The bad URL was introduced when the app was first scaffolded and
re-emitted on every full rewrite of this file. If you see it, replace it with
`https://schema.tauri.app/config/2` and do not let an assistant "correct" it.

## Release Process

```bash
# 1. Bump version in all four files (must match — CI verifies the first three):
#    - desktop_app/src-tauri/tauri.conf.json ("version": "X.Y.Z")
#    - desktop_app/package.json ("version": "X.Y.Z")
#    - desktop_app/src-tauri/Cargo.toml (version = "X.Y.Z")
#    - desktop_app/src-tauri/Cargo.lock (minerva-desktop entry)

# 2. Commit and tag
git add -A && git commit -m "chore: bump desktop app to vX.Y.Z"
git tag desktop-vX.Y.Z
git push origin dev
git push origin desktop-vX.Y.Z

# 3. CI builds all platforms → creates draft release on minerva-desktop repo

# 4. Review and publish
gh release edit desktop-vX.Y.Z --repo Minerva-Coach/minerva-desktop --draft=false
```

## GitHub Secrets Required (on MinervaMVP repo)

| Secret | Purpose |
|--------|---------|
| `TAURI_SIGNING_PRIVATE_KEY` | Signs update bundles (single line, no newlines) |
| `RELEASES_REPO_TOKEN` | PAT with repo scope for pushing releases to minerva-desktop |

## Backend Endpoints Used by Desktop App

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/login?desktop_callback=...` | GET | OAuth flow with localhost redirect |
| `/oauth/connected-accounts` | GET | Platform connection status |
| `/api/meetings` | POST | Invite bot to meeting |
| `/api/v1/desktop/presence` | POST/DELETE | Heartbeat during meetings |
| `/socket.io/` | SocketIO | Real-time coaching events |

All authenticated via `Authorization: Bearer {token}` header.
