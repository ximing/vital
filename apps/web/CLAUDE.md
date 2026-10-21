# `@vital/web` — Web 工作区指令

## 这个目录负责什么

- 承载 Vital 的桌面/浏览器主工作区（Vite + React 19 + Tailwind CSS v4 + `@rabjs/react` + TanStack Query，开发端口 `5180`）。
- 同时作为 `apps/desktop`（Tauri 2 桌面端）直接加载的前端界面。

## 放置约束

- **放什么**：
  - `src/features/<domain>/`：按业务域（`today`、`todos`、`inbox`、`reports`、`days`、`settings`、`agent-chat` 等）组织视图组件、领域模型、TanStack Query hooks（`queries.ts` / `query-keys.ts`）以及局部 `@rabjs/react` 服务（`*-ui.service.ts` / `*-page.service.ts`）。
  - `src/shell/`：应用骨架（`Rail` / `Library` / `Focus Canvas` / `Detail`）、导航路由守卫与全局快捷键管理。
  - `src/ui/`：跨业务域复用的基础 UI 原语（`field.tsx`、`date-field.tsx`、`time-field.tsx`、`overlay.tsx`、`confirm-dialog.tsx` 等）。
  - `src/services/`：全局应用级 `@rabjs/react` 服务（如鉴权、主题、全局查询管理）。
  - `src/copy.ts`：全局中文（`zh-CN`）界面文案集中定义。
- **不放什么**：
  - 不要把仅单个 feature 使用的私有组件或状态放进 `src/ui/` 或 `src/services/`。
  - 不要在组件里硬编码散落的中文文案或直接写死应用版本号。
  - 不要把跨端可复用的 DTO 校验或通用 Markdown / 正文解析逻辑留在 `apps/web` 内（应放到 `packages/*`）。

## 开发偏好与局部范式

1. **状态分层（TanStack Query + `@rabjs/react`）**：
   - 服务端数据拉取、缓存与变更优先走 TanStack Query（`queries.ts`）与增量同步机制。
   - 视图局部交互状态（选区、弹层开关、阅读器字号、草稿预览等）使用继承自 `Service` 的 `@rabjs/react` 服务管理，并提供 `reset()` 以便测试清理。
2. **收件箱正文缓存保护**：
   - 列表查询与 `/api/v1/sync` 增量同步不返回收集箱正文；合并更新缓存时必须使用 `coalesceInboxBody`，严禁让无正文的同步行冲掉阅读器已加载的完整正文。
3. **工作区版式与视觉约束**：
   - 严格保持 `Rail → Library → Focus Canvas → Detail` 布局结构；`library` 与 `canvas` 容器必须使用 `min-h-0 flex-1` 填满可用高度。
   - 阅读、写作与任务主表面不使用装饰性边框，面板分界仅用 1px 发丝线（`border-subtle`）。
   - 日期、时间、日期时间控件必须复用 `src/ui/field.tsx` 中的 `FIELD_CONTROL_CLASS` 与 `FIELD_POPOVER_CLASS`。
4. **私有图片与发版版本**：
   - 仅直接渲染业务响应中的 S3 签名 URL（如 `avatarUrl`、`InboxAsset.url`），禁止把 `/api/v1/uploads/:id` 赋给 `img.src` 或通过 Blob / Object URL 绕过，且必须提供加载失败的本地占位回退。
   - 发布 Web 或桌面端前，必须先修改 `apps/web/package.json` 的 `version` 再执行构建（Vite 将其内联为 `VITE_APP_VERSION` 供设置页底部展示）。
