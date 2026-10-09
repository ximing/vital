use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::Manager;

const MAIN_LABEL: &str = "main";
const ALERT_LABEL: &str = "notify-alert";
const ALERT_WIDTH: f64 = 360.0;
const ALERT_HEIGHT: f64 = 162.0;
const ALERT_MARGIN: f64 = 16.0;
const LIGHT_CANVAS: &str = "#F3F5F2";
const DARK_CANVAS: &str = "#0F1210";

// Methods call invoke later. Do not invoke while this script is running:
// `__TAURI_INTERNALS__.invoke` is installed by a later initialization script.
const HOST_INIT_SCRIPT: &str = r#"
try {
  if (!window.__VITAL_HOST__) {
    Object.defineProperty(window, "__VITAL_HOST__", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: (function () {
        var listeners = new Set();
        var queued = [];
        function windowLabel() {
          var internals = window.__TAURI_INTERNALS__;
          var meta = internals && internals.metadata;
          var current = meta && meta.currentWindow;
          return current && current.label;
        }
        function invoke(command, args) {
          var internals = window.__TAURI_INTERNALS__;
          if (!internals || typeof internals.invoke !== "function") return;
          void internals.invoke(command, args).catch(function () {});
        }
        function deliver(input) {
          if (listeners.size === 0) {
            queued.push(input);
            return;
          }
          listeners.forEach(function (listener) {
            try {
              listener(input);
            } catch (error) {}
          });
        }
        return {
          kind: "desktop",
          applyChrome: function (input) {
            var label = windowLabel();
            if ((label && label !== "main") || !input) return;
            invoke("apply_chrome", { scheme: input.scheme, background: input.background });
          },
          showStickyAlert: function (input) {
            var label = windowLabel();
            if ((label && label !== "main") || !input) return;
            var theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
            invoke("show_sticky_alert", { payload: input, theme: theme });
          },
          listenStickyAlerts: function (onItem) {
            listeners.add(onItem);
            var pending = queued.splice(0, queued.length);
            for (var i = 0; i < pending.length; i += 1) {
              try {
                onItem(pending[i]);
              } catch (error) {}
            }
            return Promise.resolve(function () {
              listeners.delete(onItem);
            });
          },
          __deliverStickyAlert: deliver,
          closeStickyAlert: function () {
            var label = windowLabel();
            if (label && label !== "notify-alert") return;
            invoke("close_sticky_alert");
          },
          openInMain: function (url) {
            var label = windowLabel();
            if (label && label !== "notify-alert") return;
            invoke("open_in_main", { url: url });
          },
          openExternal: function (url) {
            var label = windowLabel();
            if ((label && label !== "main") || typeof url !== "string") return;
            invoke("open_external", { url: url });
          },
          hideMain: function () {
            var label = windowLabel();
            if (label && label !== "main") return;
            invoke("hide_main");
          },
          setBadge: function (count, overlayPng) {
            var label = windowLabel();
            if (label && label !== "main") return;
            invoke("set_badge", { count: count, overlayPng: overlayPng });
          }
        };
      })()
    });
  }
} catch (error) {}
"#;

struct AlertHub {
    gate: Mutex<()>,
    pending: Mutex<Vec<StickyAlertPayload>>,
    ready: AtomicBool,
}

impl Default for AlertHub {
    fn default() -> Self {
        Self {
            gate: Mutex::new(()),
            pending: Mutex::new(Vec::new()),
            ready: AtomicBool::new(false),
        }
    }
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
struct StickyAlertPayload {
    id: String,
    title: String,
    body: String,
    url: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .with_denylist(&[ALERT_LABEL])
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .append_invoke_initialization_script(HOST_INIT_SCRIPT)
        .invoke_handler(tauri::generate_handler![
            apply_chrome,
            show_sticky_alert,
            close_sticky_alert,
            open_in_main,
            open_external,
            hide_main,
            set_badge,
        ])
        .menu(build_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "reload" => reload_main(app),
            "undo" => eval_main(app, MENU_UNDO_SCRIPT),
            "close-window" => eval_main(app, MENU_CLOSE_SCRIPT),
            "new-task" | "new-inbox" | "palette" | "find" | "shortcuts" | "settings" | "go-today"
            | "go-todos" | "go-inbox" | "go-habits" | "go-reports" | "go-days" | "agent" => {
                emit_menu(app, event.id().as_ref());
            }
            _ => {}
        })
        .setup(|app| {
            app.manage(AlertHub::default());
            install_main_window(app)?;
            install_tray(app)?;
            Ok(())
        })
        .on_window_event(on_window_event)
        .build(tauri::generate_context!())
        .expect("error while running Vital")
        .run(on_run_event);
}

fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() == ALERT_LABEL {
        if let tauri::WindowEvent::Destroyed = event {
            if let Some(hub) = window.try_state::<AlertHub>() {
                hub.ready.store(false, Ordering::SeqCst);
                let mut pending = hub.pending.lock().unwrap_or_else(|err| err.into_inner());
                pending.clear();
            }
        }
    }
    #[cfg(target_os = "macos")]
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == MAIN_LABEL {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

fn on_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen {
        has_visible_windows,
        ..
    } = event
    {
        if !has_visible_windows {
            show_main(app);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

const MENU_UNDO_SCRIPT: &str = r#"(()=>{var fn=window.__VITAL_UNDO_COMPLETE__;if(typeof fn==='function'&&fn())return;document.execCommand('undo');})()"#;
const MENU_CLOSE_SCRIPT: &str = r#"(()=>{var fn=window.__VITAL_CLOSE_LAYER__;if(typeof fn==='function'&&fn())return;var host=window.__VITAL_HOST__;if(host&&typeof host.hideMain==='function')host.hideMain();})()"#;

fn reload_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.reload();
    }
}

fn eval_main(app: &tauri::AppHandle, script: &str) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.eval(script);
    }
}

fn emit_menu(app: &tauri::AppHandle, action: &str) {
    let script = format!(
        "window.dispatchEvent(new CustomEvent('vital:menu',{{detail:'{action}'}}))"
    );
    eval_main(app, &script);
}

fn build_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let version = app.package_info().version.to_string();
    let about = AboutMetadata {
        name: Some("Vital".into()),
        version: Some(version.clone()),
        ..Default::default()
    };
    let version_item = MenuItem::with_id(
        app,
        "version",
        format!("版本 {version}"),
        false,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, Some("CmdOrCtrl+,"))?;
    let new_task = MenuItem::with_id(app, "new-task", "新建任务", true, Some("CmdOrCtrl+N"))?;
    let new_inbox =
        MenuItem::with_id(app, "new-inbox", "新建收集", true, Some("CmdOrCtrl+Shift+N"))?;
    let undo = MenuItem::with_id(app, "undo", "撤销", true, Some("CmdOrCtrl+Z"))?;
    let reload = MenuItem::with_id(app, "reload", "重新加载", true, Some("CmdOrCtrl+R"))?;
    let palette = MenuItem::with_id(app, "palette", "命令面板", true, Some("CmdOrCtrl+K"))?;
    let find = MenuItem::with_id(app, "find", "搜索", true, Some("CmdOrCtrl+F"))?;
    let agent = MenuItem::with_id(app, "agent", "助手", true, Some("CmdOrCtrl+J"))?;
    let go_today = MenuItem::with_id(app, "go-today", "今天", true, Some("CmdOrCtrl+1"))?;
    let go_todos = MenuItem::with_id(app, "go-todos", "待办", true, Some("CmdOrCtrl+2"))?;
    let go_inbox = MenuItem::with_id(app, "go-inbox", "收集", true, Some("CmdOrCtrl+3"))?;
    let go_habits = MenuItem::with_id(app, "go-habits", "习惯", true, Some("CmdOrCtrl+4"))?;
    let go_reports = MenuItem::with_id(app, "go-reports", "回顾", true, Some("CmdOrCtrl+5"))?;
    let go_days = MenuItem::with_id(app, "go-days", "日子", true, Some("CmdOrCtrl+6"))?;
    let close = MenuItem::with_id(app, "close-window", "关闭", true, Some("CmdOrCtrl+W"))?;
    let shortcuts = MenuItem::with_id(app, "shortcuts", "键盘快捷键", true, Some("CmdOrCtrl+/"))?;
    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &undo,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "显示",
        true,
        &[
            &palette,
            &find,
            &agent,
            &PredefinedMenuItem::separator(app)?,
            &go_today,
            &go_todos,
            &go_inbox,
            &go_habits,
            &go_reports,
            &go_days,
            &PredefinedMenuItem::separator(app)?,
            &reload,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some("全屏"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放"))?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            &close,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            "Vital",
            true,
            &[
                &PredefinedMenuItem::about(app, Some("关于 Vital"), Some(about))?,
                &version_item,
                &PredefinedMenuItem::separator(app)?,
                &settings,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, Some("服务"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, Some("隐藏 Vital"))?,
                &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
                &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, Some("退出 Vital"))?,
            ],
        )?;
        let file = Submenu::with_items(app, "文件", true, &[&new_task, &new_inbox])?;
        let help = Submenu::with_items(app, "帮助", true, &[&shortcuts])?;
        return Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help]);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let file = Submenu::with_items(
            app,
            "文件",
            true,
            &[
                &new_task,
                &new_inbox,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, Some("退出"))?,
            ],
        )?;
        let help = Submenu::with_items(
            app,
            "帮助",
            true,
            &[
                &shortcuts,
                &settings,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::about(app, Some("关于 Vital"), Some(about))?,
                &version_item,
            ],
        )?;
        Menu::with_items(app, &[&file, &edit, &view, &window, &help])
    }
}

/// Config marks the main window `create: false` so this can deny popup
/// webviews. `target="_blank"` and Command-click otherwise do nothing.
fn install_main_window(app: &tauri::App) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_LABEL)
        .cloned()
        .expect("main window config");
    tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
        .on_new_window(|url, _features| {
            if let Some(target) = external_link_url(url.as_str()) {
                let _ = spawn_external(&target);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let show = MenuItem::with_id(app, "show", "打开 Vital", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    let tray = TrayIconBuilder::with_id("tray")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Vital")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(tray);
    Ok(())
}

#[tauri::command]
fn hide_main(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != MAIN_LABEL {
        return Err("hide_main is main-only".into());
    }
    window.hide().map_err(|err| err.to_string())
}

#[tauri::command]
fn set_badge(
    window: tauri::WebviewWindow,
    count: Option<i64>,
    overlay_png: Option<String>,
) -> Result<(), String> {
    if window.label() != MAIN_LABEL {
        return Err("set_badge is main-only".into());
    }
    let count = count.filter(|value| *value > 0);
    #[cfg(target_os = "windows")]
    {
        let icon = match (count, overlay_png) {
            (Some(_), Some(png)) => {
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(png)
                    .map_err(|err| err.to_string())?;
                Some(tauri::image::Image::from_bytes(&bytes).map_err(|err| err.to_string())?)
            }
            _ => None,
        };
        window.set_overlay_icon(icon).map_err(|err| err.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = overlay_png;
        window.set_badge_count(count).map_err(|err| err.to_string())
    }
}

#[tauri::command]
fn apply_chrome(
    window: tauri::WebviewWindow,
    scheme: String,
    background: String,
) -> Result<(), String> {
    if window.label() != MAIN_LABEL {
        return Err("apply_chrome is main-only".into());
    }
    let (theme, color) = canvas_chrome(&scheme, &background)?;
    window
        .set_theme(Some(theme))
        .map_err(|err| err.to_string())?;
    window
        .set_background_color(Some(color))
        .map_err(|err| err.to_string())?;
    Ok(())
}

// Async so Windows does not deadlock inside a synchronous command while creating a window.
#[tauri::command]
async fn show_sticky_alert(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    payload: StickyAlertPayload,
    theme: Option<String>,
) -> Result<(), String> {
    show_alert(window, app, payload, theme)
}

#[tauri::command]
fn close_sticky_alert(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != ALERT_LABEL {
        return Err("close_sticky_alert is notify-alert-only".into());
    }
    window.close().map_err(|err| err.to_string())
}

/// System browser. The webview drops `target="_blank"` and Command-clicks.
#[tauri::command]
fn open_external(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    if window.label() != MAIN_LABEL {
        return Err("open_external is main-only".into());
    }
    let target = external_link_url(&url).ok_or_else(|| "rejected".to_string())?;
    spawn_external(&target)
}

fn external_link_url(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.len() > 2048 {
        return None;
    }
    if trimmed.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return None;
    }
    let url = tauri::Url::parse(trimmed).ok()?;
    match url.scheme() {
        "http" | "https" => {
            if url.host_str().map(str::is_empty).unwrap_or(true) {
                return None;
            }
            Some(url.to_string())
        }
        "mailto" => {
            if url.path().is_empty() {
                return None;
            }
            Some(url.to_string())
        }
        _ => None,
    }
}

fn spawn_external(url: &str) -> Result<(), String> {
    // cmd.exe /C start parses the URL again. ShellExecuteW takes one wide string.
    #[cfg(target_os = "windows")]
    {
        return shell_execute_open(url);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut command = external_open_command(url);
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|err| err.to_string())
    }
}

#[cfg(target_os = "windows")]
fn shell_execute_open(url: &str) -> Result<(), String> {
    let verb = wide_null("open");
    let file = wide_null(url);
    let result = unsafe {
        windows_sys::Win32::UI::Shell::ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
        )
    };
    let code = result as isize;
    if code > 32 {
        Ok(())
    } else {
        Err(code.to_string())
    }
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(not(target_os = "windows"))]
fn external_open_command(url: &str) -> std::process::Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        return command;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    }
}

#[tauri::command]
fn open_in_main(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    url: String,
) -> Result<(), String> {
    if window.label() != ALERT_LABEL {
        return Err("open_in_main is notify-alert-only".into());
    }
    let path = normalize_open_path(&url).ok_or_else(|| "rejected".to_string())?;
    let origin = shell_origin(&app)?;
    let target = navigation_url(&origin, &path)?;
    let Some(main) = app.get_webview_window(MAIN_LABEL) else {
        return Err("main window missing".into());
    };
    let navigated = main.navigate(target);
    let _ = main.unminimize();
    let _ = main.show();
    let _ = main.set_focus();
    navigated.map_err(|err| err.to_string())
}

fn show_alert(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    payload: StickyAlertPayload,
    theme: Option<String>,
) -> Result<(), String> {
    if window.label() != MAIN_LABEL {
        return Err("show_sticky_alert is main-only".into());
    }
    if payload.id.is_empty() {
        return Err("missing alert id".into());
    }
    let hub = app.state::<AlertHub>();
    let _gate = hub.gate.lock().unwrap_or_else(|err| err.into_inner());
    let theme = resolve_theme(&window, theme);
    if let Some(alert) = app.get_webview_window(ALERT_LABEL) {
        focus_alert(&alert, theme);
        if hub.ready.load(Ordering::SeqCst) {
            let _ = alert.eval(deliver_script(&payload)?);
        } else {
            push_pending(&hub, payload);
        }
        return Ok(());
    }
    let origin = shell_origin(&app)?;
    let page = alert_page_url(&origin, &payload)?;
    push_pending(&hub, payload);
    let alert = build_alert_window(&app, page, theme, alert_position(&window))?;
    focus_alert(&alert, theme);
    Ok(())
}

fn canvas_chrome(
    scheme: &str,
    background: &str,
) -> Result<(tauri::Theme, tauri::utils::config::Color), String> {
    // Only the web canvas colors from @vital/tokens.
    let background = background.trim();
    if scheme == "light" && background.eq_ignore_ascii_case(LIGHT_CANVAS) {
        return Ok((
            tauri::Theme::Light,
            tauri::utils::config::Color(0xF3, 0xF5, 0xF2, 255),
        ));
    }
    if scheme == "dark" && background.eq_ignore_ascii_case(DARK_CANVAS) {
        return Ok((
            tauri::Theme::Dark,
            tauri::utils::config::Color(0x0F, 0x12, 0x10, 255),
        ));
    }
    Err("unsupported chrome color".into())
}

fn resolve_theme(window: &tauri::WebviewWindow, theme: Option<String>) -> tauri::Theme {
    let fallback = window.theme().unwrap_or(tauri::Theme::Dark);
    match theme.as_deref().map(str::trim) {
        Some(value) if value.eq_ignore_ascii_case("light") => tauri::Theme::Light,
        Some(value) if value.eq_ignore_ascii_case("dark") => tauri::Theme::Dark,
        _ => fallback,
    }
}

fn build_alert_window(
    app: &tauri::AppHandle,
    page: tauri::Url,
    theme: tauri::Theme,
    pos: Option<(f64, f64)>,
) -> Result<tauri::WebviewWindow, String> {
    let mut builder =
        tauri::WebviewWindowBuilder::new(app, ALERT_LABEL, tauri::WebviewUrl::External(page))
            .title("Vital")
            .inner_size(ALERT_WIDTH, ALERT_HEIGHT)
            .min_inner_size(ALERT_WIDTH, ALERT_HEIGHT)
            .max_inner_size(ALERT_WIDTH, ALERT_HEIGHT)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .closable(true)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .shadow(true)
            .focused(true)
            .theme(Some(theme))
            .on_page_load(|alert, payload| {
                let Some(hub) = alert.try_state::<AlertHub>() else {
                    return;
                };
                match payload.event() {
                    tauri::webview::PageLoadEvent::Started => {
                        hub.ready.store(false, Ordering::SeqCst);
                    }
                    tauri::webview::PageLoadEvent::Finished => {
                        hub.ready.store(true, Ordering::SeqCst);
                        flush_pending(&alert, &hub);
                    }
                }
            });
    builder = match pos {
        Some((x, y)) => builder.position(x, y),
        None => builder.center(),
    };
    builder.build().map_err(|err| err.to_string())
}

fn focus_alert(alert: &tauri::WebviewWindow, theme: tauri::Theme) {
    let _ = alert.set_theme(Some(theme));
    let _ = alert.unminimize();
    let _ = alert.show();
    let _ = alert.set_always_on_top(true);
    let _ = alert.set_focus();
    let _ = alert.request_user_attention(Some(tauri::UserAttentionType::Critical));
}

fn alert_position(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let monitor = window.current_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    if !(scale.is_finite() && scale > 0.0) {
        return None;
    }
    let area = monitor.work_area();
    let origin = area.position.to_logical::<f64>(scale);
    let size = area.size.to_logical::<f64>(scale);
    Some(sticky_alert_position(
        origin.x,
        origin.y,
        size.width,
        size.height,
    ))
}

fn sticky_alert_position(x: f64, y: f64, width: f64, height: f64) -> (f64, f64) {
    let px = js_round((x + ALERT_MARGIN).max(x + width - ALERT_WIDTH - ALERT_MARGIN));
    let py = js_round(y.max((y + ALERT_MARGIN).min(y + height - ALERT_HEIGHT - ALERT_MARGIN)));
    (px, py)
}

fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn push_pending(hub: &AlertHub, payload: StickyAlertPayload) {
    let mut pending = hub.pending.lock().unwrap_or_else(|err| err.into_inner());
    if pending.iter().any(|item| item.id == payload.id) {
        return;
    }
    pending.push(payload);
}

fn flush_pending(alert: &tauri::WebviewWindow, hub: &AlertHub) {
    let pending = {
        let mut guard = hub.pending.lock().unwrap_or_else(|err| err.into_inner());
        std::mem::take(&mut *guard)
    };
    for payload in pending {
        if let Ok(script) = deliver_script(&payload) {
            let _ = alert.eval(script);
        }
    }
}

fn deliver_script(payload: &StickyAlertPayload) -> Result<String, String> {
    let json = serde_json::to_string(payload).map_err(|err| err.to_string())?;
    let json = json
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
        .replace('<', "\\u003c");
    Ok(format!(
        "(()=>{{const host=window.__VITAL_HOST__;if(host&&typeof host.__deliverStickyAlert==='function')host.__deliverStickyAlert({json});}})()"
    ))
}

fn alert_page_url(origin: &str, payload: &StickyAlertPayload) -> Result<tauri::Url, String> {
    let json = serde_json::to_string(payload).map_err(|err| err.to_string())?;
    let mut url = tauri::Url::parse(&format!("{origin}/")).map_err(|err| err.to_string())?;
    url.set_fragment(Some(&format!(
        "vital-alert={}",
        encode_uri_component(&json)
    )));
    Ok(url)
}

// Configured shell origin, not whatever origin the main webview has navigated to.
fn shell_origin(app: &tauri::AppHandle) -> Result<String, String> {
    let build = &app.config().build;
    let url = if cfg!(debug_assertions) {
        build
            .dev_url
            .clone()
            .ok_or_else(|| "missing devUrl".to_string())?
    } else {
        match build.frontend_dist.as_ref() {
            Some(tauri::utils::config::FrontendDist::Url(url)) => url.clone(),
            _ => return Err("frontendDist must be a URL".into()),
        }
    };
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn navigation_url(origin: &str, path: &str) -> Result<tauri::Url, String> {
    let origin_url =
        tauri::Url::parse(&format!("{origin}/")).map_err(|_| "bad origin".to_string())?;
    let target =
        tauri::Url::parse(&format!("{origin}{path}")).map_err(|_| "bad path".to_string())?;
    if target.scheme() != origin_url.scheme()
        || target.host_str() != origin_url.host_str()
        || target.port_or_known_default() != origin_url.port_or_known_default()
    {
        return Err("rejected".into());
    }
    Ok(target)
}

fn normalize_open_path(input: &str) -> Option<String> {
    if input.starts_with("//") || input.contains('\\') {
        return None;
    }
    if let Some(scheme) = url_scheme(input) {
        if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
            return None;
        }
    }
    let path = app_path_from_notify_url(input);
    if path.contains('\\') || !one_leading_slash(&path) {
        return None;
    }
    Some(path)
}

fn app_path_from_notify_url(url: &str) -> String {
    const FALLBACK: &str = "/today";
    if url.is_empty() {
        return FALLBACK.to_string();
    }
    if !starts_with_ignore_ascii_case(url, "http://")
        && !starts_with_ignore_ascii_case(url, "https://")
    {
        if url.starts_with('/') {
            return url.to_string();
        }
        return format!("/{url}");
    }
    let Ok(parsed) = tauri::Url::parse(url) else {
        return FALLBACK.to_string();
    };
    let mut path = parsed.path().to_string();
    if let Some(query) = parsed.query() {
        path.push('?');
        path.push_str(query);
    }
    if let Some(fragment) = parsed.fragment() {
        path.push('#');
        path.push_str(fragment);
    }
    if path.is_empty() {
        FALLBACK.to_string()
    } else {
        path
    }
}

fn url_scheme(input: &str) -> Option<&str> {
    let bytes = input.as_bytes();
    match bytes.first() {
        Some(byte) if byte.is_ascii_alphabetic() => {}
        _ => return None,
    }
    let mut end = 1;
    while end < bytes.len() {
        let byte = bytes[end];
        if byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.') {
            end += 1;
        } else {
            break;
        }
    }
    if bytes.get(end) == Some(&b':') {
        Some(&input[..end])
    } else {
        None
    }
}

fn one_leading_slash(path: &str) -> bool {
    let mut chars = path.chars();
    chars.next() == Some('/') && chars.next() != Some('/')
}

fn starts_with_ignore_ascii_case(value: &str, prefix: &str) -> bool {
    value.len() >= prefix.len()
        && value
            .as_bytes()
            .get(..prefix.len())
            .is_some_and(|bytes| bytes.eq_ignore_ascii_case(prefix.as_bytes()))
}

fn encode_uri_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_path_keeps_app_paths_and_strips_http_origins() {
        assert_eq!(
            normalize_open_path("/todos/lists/l1?task=t1").as_deref(),
            Some("/todos/lists/l1?task=t1")
        );
        assert_eq!(normalize_open_path("/today").as_deref(), Some("/today"));
        assert_eq!(
            normalize_open_path("https://vital.aimo.plus/todos/lists/l1?task=t1").as_deref(),
            Some("/todos/lists/l1?task=t1")
        );
        assert_eq!(
            normalize_open_path("https://evil.example/today").as_deref(),
            Some("/today")
        );
        assert_eq!(
            normalize_open_path("http://user:pass@evil.example/today").as_deref(),
            Some("/today")
        );
        assert_eq!(normalize_open_path("").as_deref(), Some("/today"));
        assert_eq!(normalize_open_path("today").as_deref(), Some("/today"));
    }

    #[test]
    fn open_path_rejects_protocol_relative_backslash_and_non_http_schemes() {
        assert_eq!(normalize_open_path("//evil.example/today"), None);
        assert_eq!(normalize_open_path("/todos\\lists"), None);
        assert_eq!(normalize_open_path("javascript:alert(1)"), None);
        assert_eq!(normalize_open_path("JAVASCRIPT:alert(1)"), None);
        assert_eq!(normalize_open_path("file:///etc/passwd"), None);
        assert_eq!(normalize_open_path("https://evil.example//today"), None);
    }

    #[test]
    fn external_links_are_http_https_or_mailto() {
        assert_eq!(
            external_link_url("https://example.com/a?b=1#c").as_deref(),
            Some("https://example.com/a?b=1#c")
        );
        assert_eq!(
            external_link_url("  http://example.com/path  ").as_deref(),
            Some("http://example.com/path")
        );
        assert_eq!(
            external_link_url("mailto:reader@example.com").as_deref(),
            Some("mailto:reader@example.com")
        );
        assert_eq!(external_link_url("javascript:alert(1)"), None);
        assert_eq!(external_link_url("file:///etc/passwd"), None);
        assert_eq!(external_link_url("/today"), None);
        assert_eq!(external_link_url("https://"), None);
        assert_eq!(external_link_url("mailto:"), None);
        assert_eq!(external_link_url("https://example.com/a\nb"), None);
        assert_eq!(external_link_url("https://exa mple.com"), None);
        assert_eq!(external_link_url(""), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn external_open_command_passes_the_url_as_one_argument() {
        let url = "https://example.com/a?b=1&c=2";
        let command = external_open_command(url);
        assert_eq!(command.get_program(), "open");
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(args, [std::ffi::OsStr::new(url)]);
    }

    #[test]
    fn navigation_stays_on_the_shell_origin() {
        let url = navigation_url("https://vital.aimo.plus", "/today").unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("vital.aimo.plus"));
        assert_eq!(url.path(), "/today");
        let query = navigation_url("http://localhost:5180", "/todos/lists/l1?task=t1").unwrap();
        assert_eq!(query.host_str(), Some("localhost"));
        assert_eq!(query.port(), Some(5180));
        assert_eq!(query.path(), "/todos/lists/l1");
        assert_eq!(query.query(), Some("task=t1"));
    }

    #[test]
    fn canvas_colors_are_the_only_chrome_accepted() {
        assert!(canvas_chrome("light", "#F3F5F2").is_ok());
        assert!(canvas_chrome("dark", "#0f1210").is_ok());
        assert!(canvas_chrome("light", "#000000").is_err());
        assert!(canvas_chrome("dark", "#F3F5F2").is_err());
        assert!(canvas_chrome("blue", "#F3F5F2").is_err());
    }

    #[test]
    fn sticky_position_is_top_right_of_the_work_area() {
        assert_eq!(
            sticky_alert_position(0.0, 25.0, 1440.0, 900.0),
            (1064.0, 41.0)
        );
    }

    #[test]
    fn alert_url_uses_the_shell_origin_and_round_trips_the_payload() {
        let payload = StickyAlertPayload {
            id: "n1".into(),
            title: "任务提醒".into(),
            body: "100% #done".into(),
            url: "/today".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        let url = alert_page_url("https://vital.aimo.plus", &payload).unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("vital.aimo.plus"));
        let fragment = url.fragment().unwrap();
        assert!(fragment.starts_with("vital-alert="), "{fragment}");
        let encoded = &fragment["vital-alert=".len()..];
        let decoded = percent_decode(encoded);
        assert_eq!(decoded, json);
        assert!(!url.as_str().contains("evil"));
    }

    fn percent_decode(input: &str) -> String {
        let bytes = input.as_bytes();
        let mut out = Vec::new();
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] == b'%' && index + 2 < bytes.len() {
                if let Ok(byte) = u8::from_str_radix(
                    std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""),
                    16,
                ) {
                    out.push(byte);
                    index += 3;
                    continue;
                }
            }
            out.push(bytes[index]);
            index += 1;
        }
        String::from_utf8(out).unwrap_or_default()
    }
}
