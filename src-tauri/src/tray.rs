//! System tray icon for Windows and macOS.
//!
//! Provides a tray icon with a context menu so the user can show/hide the
//! panel manually — useful outside of active meetings and for quick access.
//!
//! Left-click toggles panel visibility; right-click opens the menu.
//!
//! Not compiled on Linux: the GTK tray backend panicked during earlier testing
//! (see `process_detector.rs` comments on glib channel dispatch).

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Emitter, Manager,
};

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("tray_show", "Show Minerva").build(app)?;
    let hide = MenuItemBuilder::with_id("tray_hide", "Hide Minerva").build(app)?;
    let about = MenuItemBuilder::with_id("tray_about", "About…").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("tray_quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show, &hide, &about, &separator, &quit])
        .build()?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default window icon from tauri.conf.json");

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Minerva Coach")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_show" => {
                let _ = show_all(app);
            }
            "tray_hide" => {
                let _ = hide_all(app);
            }
            "tray_about" => {
                // Make sure the panel is visible before asking it to open
                // the modal — the frontend listener lives in the panel.
                let _ = show_all(app);
                let _ = app.emit("show-about", ());
            }
            "tray_quit" => {
                log::info!("Tray 'Quit' selected — exiting app");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let visible = app
                    .get_webview_window("panel")
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                let _ = if visible { hide_all(app) } else { show_all(app) };
            }
        })
        .build(app)?;

    Ok(())
}

fn show_all(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("panel") {
        w.show()?;
        let _ = w.set_focus();
    }
    Ok(())
}

fn hide_all(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("panel") {
        w.hide()?;
    }
    Ok(())
}
