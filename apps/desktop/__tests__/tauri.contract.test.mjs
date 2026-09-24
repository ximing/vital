import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

describe('Tauri desktop contract', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  const cargo = read('src-tauri/Cargo.toml');
  const lib = read('src-tauri/src/lib.rs');
  const build = read('src-tauri/build.rs');
  const caps = JSON.parse(read('src-tauri/capabilities/default.json'));
  const pkg = JSON.parse(read('package.json'));

  it('loads the hosted site in production and vite on 5180 in dev', () => {
    assert.equal(conf.identifier, 'plus.aimo.vital');
    assert.equal(conf.productName, 'Vital');
    assert.equal(conf.build.devUrl, 'http://localhost:5180');
    assert.equal(conf.build.frontendDist, 'https://vital.aimo.plus');
    assert.equal(conf.build.beforeBuildCommand, undefined);
    assert.equal(conf.app.withGlobalTauri, false);
    assert.equal(caps.remote, undefined);
  });

  it('uses a 1280x800 window, min 960x640, native titlebar that follows the app theme', () => {
    const win = conf.app.windows[0];
    assert.equal(win.label, 'main');
    assert.equal(win.width, 1280);
    assert.equal(win.height, 800);
    assert.equal(win.minWidth, 960);
    assert.equal(win.minHeight, 640);
    assert.equal(win.theme, undefined);
    assert.equal(win.backgroundColor, undefined);
    assert.notEqual(win.decorations, false);
    assert.ok(win.titleBarStyle === undefined || win.titleBarStyle === 'Visible');
    assert.match(lib, /set_theme/);
    assert.match(lib, /set_background_color/);
    assert.match(lib, /#F3F5F2/);
    assert.match(lib, /#0F1210/);
  });

  it('keeps window-state and notification, and drops http and store', () => {
    assert.doesNotMatch(lib, /tauri_plugin_http/);
    assert.doesNotMatch(lib, /tauri_plugin_store/);
    assert.match(lib, /tauri_plugin_window_state::Builder/);
    assert.match(lib, /tauri_plugin_notification::init/);
    assert.doesNotMatch(cargo, /tauri-plugin-http/);
    assert.doesNotMatch(cargo, /tauri-plugin-store/);
    assert.doesNotMatch(cargo, /unsafe-headers/);
    assert.match(cargo, /tauri-plugin-window-state/);
    assert.match(cargo, /tauri-plugin-notification/);
    assert.doesNotMatch(cargo, /features = \[[^\]]*cookies/);
  });

  it('registers a native menu with Cmd/Ctrl+R reload and edit shortcuts', () => {
    assert.match(lib, /\.menu\(build_menu\)/);
    assert.match(lib, /CmdOrCtrl\+R/);
    assert.match(lib, /重新加载/);
    assert.match(lib, /window\.reload\(\)/);
    assert.match(lib, /PredefinedMenuItem::copy/);
    assert.match(lib, /PredefinedMenuItem::paste/);
    assert.match(lib, /PredefinedMenuItem::undo/);
    assert.match(lib, /PredefinedMenuItem::select_all/);
    assert.match(lib, /PredefinedMenuItem::quit/);
  });

  it('shows the shell version from package_info in the menu and about dialog', () => {
    assert.match(lib, /package_info\(\)\.version/);
    assert.match(lib, /版本/);
    assert.match(lib, /AboutMetadata/);
    assert.match(lib, /version: Some\(version/);
  });

  it('on macOS, the red close button hides instead of quitting', () => {
    assert.match(lib, /CloseRequested/);
    assert.match(lib, /prevent_close/);
    assert.match(lib, /window\.hide\(\)/);
    assert.match(lib, /label\(\) == MAIN_LABEL/);
    assert.match(lib, /with_denylist/);
    assert.match(lib, /ALERT_LABEL/);
    assert.match(lib, /RunEvent::Reopen/);
    assert.match(lib, /target_os = "macos"/);
    assert.match(lib, /StateFlags::VISIBLE/);
  });

  it('puts a template tray icon in the macOS menu bar', () => {
    assert.match(lib, /TrayIconBuilder/);
    assert.match(lib, /icon_as_template\(true\)/);
    assert.match(lib, /icons\/tray\.png/);
    assert.match(cargo, /tray-icon/);
    assert.match(cargo, /image-png/);
    assert.ok(read('src-tauri/icons/tray.png').length > 0);
  });

  it('registers host commands in AppManifest and limits the local capability', () => {
    assert.match(build, /AppManifest::new\(\)/);
    assert.match(build, /try_build/);
    for (const command of [
      'apply_chrome',
      'show_sticky_alert',
      'close_sticky_alert',
      'open_in_main',
    ]) {
      assert.match(build, new RegExp(command));
      assert.match(lib, new RegExp(`fn ${command}`));
    }
    assert.equal(caps.local, true);
    assert.deepEqual(caps.windows, ['main', 'notify-alert']);
    const ids = caps.permissions.map((entry) =>
      typeof entry === 'string' ? entry : entry.identifier,
    );
    assert.deepEqual(
      [...ids].sort(),
      [
        'allow-apply-chrome',
        'allow-close-sticky-alert',
        'allow-open-in-main',
        'allow-show-sticky-alert',
        'notification:default',
      ].sort(),
    );
    const text = JSON.stringify(caps);
    for (const forbidden of [
      'core:default',
      'http:default',
      'store:default',
      'allow-create',
      'allow-create-webview-window',
      'window-state:default',
      'core:window:allow-',
      'core:event',
    ]) {
      assert.equal(text.includes(forbidden), false, forbidden);
    }
  });

  it('installs __VITAL_HOST__ before page scripts and keeps sticky alerts inside the shell', () => {
    assert.match(lib, /append_invoke_initialization_script/);
    assert.match(lib, /__VITAL_HOST__/);
    assert.match(lib, /__deliverStickyAlert/);
    assert.match(lib, /__TAURI_INTERNALS__\.invoke/);
    assert.match(lib, /fn shell_origin/);
    assert.match(lib, /dev_url/);
    assert.match(lib, /frontend_dist/);
    assert.match(lib, /FrontendDist::Url/);
    assert.match(lib, /transparent\(true\)/);
    assert.match(lib, /skip_taskbar\(true\)/);
    assert.match(lib, /visible_on_all_workspaces\(true\)/);
    assert.match(lib, /always_on_top\(true\)/);
    assert.match(lib, /decorations\(false\)/);
    assert.match(lib, /request_user_attention/);
    assert.match(lib, /360\.0/);
    assert.match(lib, /162\.0/);
    assert.match(lib, /starts_with\("\/\/"\)/);
    assert.match(lib, /contains\('\\\\'\)/);
    assert.match(lib, /normalize_open_path/);
    assert.match(lib, /app_path_from_notify_url/);
    assert.match(lib, /unminimize\(\)/);
    assert.match(lib, /set_focus\(\)/);
    assert.match(lib, /label\(\) != MAIN_LABEL/);
    assert.match(lib, /label\(\) != ALERT_LABEL/);
    assert.doesNotMatch(lib, /\.url\(\)/);
  });

  it('ad-hoc signs macOS bundles so Apple Silicon is not marked damaged', () => {
    assert.equal(conf.bundle.macOS.signingIdentity, '-');
  });

  it('bundles PR1 raster icons', () => {
    for (const icon of [
      'icons/16x16.png',
      'icons/32x32.png',
      'icons/128x128.png',
      'icons/128x128@2x.png',
      'icons/256x256.png',
      'icons/icon.png',
      'icons/icon.icns',
      'icons/icon.ico',
    ]) {
      assert.ok(conf.bundle.icon.includes(icon), icon);
    }
  });

  it('does not depend on the web bundle or bearer plugins', () => {
    const deps = pkg.dependencies ?? {};
    assert.equal(deps['@vital/web'], undefined);
    assert.equal(deps['@tauri-apps/plugin-http'], undefined);
    assert.equal(deps['@tauri-apps/plugin-store'], undefined);
    assert.equal(deps['@tauri-apps/api'], undefined);
  });

  it('has a GitHub workflow that builds Windows, macOS, and Linux', () => {
    const workflow = read('../../.github/workflows/desktop-build.yml');
    assert.match(workflow, /windows-latest/);
    assert.match(workflow, /macos-latest/);
    assert.match(workflow, /ubuntu-22\.04/);
    assert.match(workflow, /tauri-apps\/tauri-action@v1/);
    assert.match(workflow, /projectPath: apps\/desktop/);
    assert.match(workflow, /VITAL_WEB_URL/);
    assert.match(workflow, /vital\.aimo\.plus/);
    assert.match(workflow, /frontendDist/);
    assert.match(workflow, /\[platform\]-\[arch\]-\[bundle\]/);
    assert.doesNotMatch(workflow, /VITE_TAURI_API_URL/);
  });
});
