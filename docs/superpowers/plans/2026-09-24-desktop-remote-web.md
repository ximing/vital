# 桌面壳加载远端 Web

壳的版本在菜单里查看。页面跟网站走，桌面不再内嵌一份网页，也不再为桌面单独做一套登录。

## 三端分开

| 端 | 界面 | 登录 | 代码住在哪 |
|---|---|---|---|
| 浏览器 | 网站 | cookie，相对路径 `/api` | `apps/web` |
| 桌面壳 | 打开同一个网站 | 与浏览器相同的 cookie | `apps/desktop`（Rust + 注入的 host） |
| 手机、扩展 | 各自的原生界面 | bearer，绝对 API 地址 | `apps/mobile`、`apps/extension`，这次不动 |

`apps/web` 不再因为 `window.__TAURI_INTERNALS__` 切换登录、接口地址或 WebSocket。检测到壳只用于壳的界面差异，而且只经过一个 host。

手机和扩展继续用自己的 `createVitalClient({ authMode: 'bearer' })`。不要把它们的逻辑抽进网页，也不要让网页再依赖 `@tauri-apps/plugin-http` 或 `plugin-store`。

## 桌面窗口加载什么

- 开发：维持 `devUrl` `http://localhost:5180`，仍是本机 Vite。网页走 Vite 代理和 cookie，和浏览器开发一致。
- 正式包：`build.frontendDist` 改成网站源站 URL，不再指向 `../../web/dist`。Tauri 2 允许 `frontendDist` 是 URL，正式窗口直接打开这个地址，不把 HTML 打进安装包。
- 这个 URL 与现在的 `VITE_TAURI_API_URL` 是同一个源站（默认 `https://vital.aimo.plus`）。构建时不再把它写进 Vite。工作流改名为 `VITAL_WEB_URL`，默认值不变。打包前只改写 `tauri.conf.json` 的 `frontendDist`。不要把它写进 `remote.urls`。
- 删掉 `beforeBuildCommand` 里构建 `@vital/web` 的步骤。`apps/desktop/package.json` 去掉对 `@vital/web`、`@tauri-apps/plugin-http`、`@tauri-apps/plugin-store` 的依赖。
- 断网时窗口没有本地页面。这是这次的取舍。

菜单里的「重新加载」继续 `reload()`，重新取线上页面。

## Host：网页和壳之间只留这一道

`frontendDist` 为 https URL 时，Tauri 2 不会把 HTML 打进安装包，初始化脚本仍会在这个远端页面上运行，包括后开的 `notify-alert`。窗口配置里没有 `initializationScript` 字段。用 `Builder::append_invoke_initialization_script`，在每个 webview 的页面脚本之前装上 `window.__VITAL_HOST__`。`withGlobalTauri` 保持 false。host 方法里稍后再调 `__TAURI_INTERNALS__.invoke`，不要在初始化脚本执行的当下同步 invoke。

网页只在 `apps/web/src/host.ts` 读取这个对象。读不到、或 `kind` 不是 `'desktop'`，就当普通浏览器。网页不再 `import('@tauri-apps/...')`。

```ts
type VitalHost = {
  kind: 'desktop';
  applyChrome(input: { scheme: 'light' | 'dark'; background: string }): void;
  showStickyAlert(input: { id: string; title: string; body: string; url: string }): void;
  listenStickyAlerts(onItem: (input: StickyAlertPayload) => void): Promise<() => void>;
  closeStickyAlert(): void;
  openInMain(url: string): void;
};
```

`showStickyAlert`、`listenStickyAlerts`、`closeStickyAlert`、`openInMain` 要盖住现在 `sticky-alert.ts` 的行为，不能只做「开一个无边框窗口」：

- `NotifyAlertPage` 只在首次从 `location.hash` 读一条，之后要继续入队。不要给页面开 `core:event` 去 `listen`。初始化脚本在 host 上注册一个投递函数，Rust 用 `notify-alert` 窗口的 `eval` 调用它。页面的 `listenStickyAlerts` 只是订阅这个函数。
- 关闭按钮现在走 `WebviewWindow.getCurrent().close()`。Rust 创建的窗口不能靠 `window.close()`。`closeStickyAlert` 由壳关掉 `notify-alert`。
- 新窗口保持现有构造参数：透明、`skipTaskbar`、`visibleOnAllWorkspaces`、固定 360×162、`alwaysOnTop`、无边框、`requestUserAttention`、工作区右上角。主题跟主窗口当前的明暗。
- 提醒窗口的 URL 用壳配置的源站（正式包的 `frontendDist`，开发时的 `devUrl`）加上 `/#vital-alert=`。不要用主 webview 当时导航到的源站，避免页面被带去别的域名后，提醒窗跟着走。

壳用 Rust 命令实现 host，并在 `build.rs` 里用 `AppManifest` 登记。现在的 `build.rs` 只有 `tauri_build::build()`，自定义命令不会进入 capability 检查。命令里核对窗口 label：

| 命令 | 谁能调 | 做什么 |
|---|---|---|
| `apply_chrome` | `main` | `set_theme` + 标题栏背景色。颜色只接受网页传来的画布色 |
| `show_sticky_alert` | `main` | 按上一节创建或聚焦 `notify-alert`，再用 `eval` 把 payload 交给提醒窗里的 host |
| `close_sticky_alert` | `notify-alert` | 关闭这个提醒窗 |
| `open_in_main` | `notify-alert` | 见下一节 |

`apps/web` 里现在碰 Tauri 的地方改成只问 host：

- `api/client.ts`：永远 cookie、`baseUrl: ''`。删掉 `isTauriRuntime`、`tauriBaseUrl`、`tauriFetch`、`createTauriTokenStore`。
- `features/sync/sync-engine.ts`：WebSocket 永远是当前页面的源站。hello 仍用内存里的 access token，和浏览器一样。
- `lib/theme.ts`：设完 `data-theme` 后，若有 host 就 `applyChrome`。
- `App.tsx`：有 host 时 `/` 进应用，否则落地页。这是唯一的路由差异。
- `features/notify/sticky-alert.ts`：纯函数（hash、偏好）留下。创建窗口、发事件改调 host。`NotifyAlertPage` 仍读 hash，后续提醒和「在主窗口打开」走 host。
- `browser-notify.service.ts`、`NotificationsSection.tsx`：用 host 判断桌面，不再用 `__TAURI_INTERNALS__`。系统通知继续用 `window.Notification`，由壳里的 notification 插件补到系统通知。

`apps/web/package.json` 去掉 `@tauri-apps/api`、`plugin-http`、`plugin-store`。

## 从提醒窗回到主窗口

服务端推送的 `url` 是绝对地址（`WEB_ORIGIN` + 路径）。现有 `appPathFromNotifyUrl` 会把任意 `http(s)` 收成路径，但以 `//` 开头的协议相对地址会被当成站内路径，`location.assign` 会离开应用。

`open_in_main` 只接受 `notify-alert`。以 `//` 开头或含反斜杠的输入先拒绝。没有方案、且恰好以一个 `/` 开头的路径直接交给 `appPathFromNotifyUrl`（页面内扫描传来的就是 `/todos/lists/…`、`/today`）。仅当输入带了方案且不是 `http` / `https` 时拒绝。收成的路径也必须恰好以一个 `/` 开头。主窗口只导航到「壳配置的源站 + 这条路径」。macOS 上红色关闭是隐藏主窗口（`prevent_close`），所以导航之后还要 `unminimize`、`show`、`set_focus`。

## 权限

在 Tauri 2.11 里，`frontendDist` 和 `devUrl` 是应用自己的地址（`get_app_url`），`https://vital.aimo.plus` 和 `http://localhost:5180` 都算 **local**，不是 remote。`capabilities/default.json` 里 `"local": true` 会把该文件里剩下的每条权限都授给这个站点。不要把这次的授权写成 `remote.urls`，也不要加通配。

`local: true` 的 capability 里只留：

- `AppManifest` 登记过的 `apply_chrome`、`show_sticky_alert`、`close_sticky_alert`、`open_in_main`
- `notification:default`（系统通知仍由插件补到 `window.Notification`）

从这份 capability 删掉 `core:default`、`http:default`、`store:default`、`core:webview:allow-create-webview-window`、`core:window:allow-create`，以及其他 `core:window:allow-*`。窗口状态插件留在 Rust 里，不作为页面权限。

`plugin-http` 和 `plugin-store` 从 Cargo.toml 卸掉。`unsafe-headers` 一并去掉。托盘和通知插件留下。

这样页面即使直接 `invoke`，也没有读令牌、任意请求或随意开窗口的命令。登录仍是网站的 `httpOnly` cookie：窗口源站等于 `WEB_ORIGIN`，`fetch` 带 cookie，服务端按现有 `Origin` 判断发 cookie。壳不保存 refresh token。

## 壳版本放在菜单

版本用 `app.package_info().version`。发布工作流已经按 tag 写入 `tauri.conf.json` 和 `Cargo.toml`，菜单读这个值，不读网页的 `VITE_APP_VERSION`。

- macOS：应用菜单里放一条不可点的「版本 x.y.z」，关于对话框的 `AboutMetadata.version` 用同一个字符串。
- Windows / Linux：帮助菜单里放同样的一条。

设置页底部仍是网站构建时写入的 `VITE_APP_VERSION`。

## 测试

- `apps/desktop/__tests__/tauri.contract.test.mjs`：正式 `frontendDist` 是 URL 或由工作流写入；菜单代码使用 `package_info().version` 且有「版本」；`build.rs` 登记 `AppManifest`；capability 在 `local: true` 下只含那几条命令和 `notification:default`，不含 `core:default`、`http:default`、`store:default`、`allow-create`、`allow-create-webview-window`；工作流使用 `VITAL_WEB_URL`，不再把 `VITE_TAURI_API_URL` 交给 Vite。
- `apps/web`：client 契约改为只有 cookie；host 的读取与「没有 host 就是浏览器」有测试；theme / sticky 不再引用 `@tauri-apps`。
- 手机、扩展的 bearer 客户端和测试保持原样。

## 不做

- 不改服务端的 cookie / bearer 判定。
- 不给壳做取 token 的桥。
- 不把壳版本写进网页设置页。
- 不改手机和扩展。
