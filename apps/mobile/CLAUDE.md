# `@vital/mobile` — 移动端指令

## 这个目录负责什么

- 承载 Vital 的移动端原生应用（Expo 54 + React Native + Expo Router，Android 优先）。
- 使用 Bearer Token 鉴权，通过 `@vital/api-client` 与 `/api/v1/sync` 增量同步协议与服务端交互，并集成华为推送、桌面角标与 APK 自更新。

## 放置约束

- **放什么**：
  - `app/`：仅放置 Expo Router 路由入口与布局壳文件（如 `(tabs)/`、`inbox/[id].tsx`），保持轻量并直接挂载 `src/features/` 中的页面组件。
  - `src/features/<domain>/`：领域视图（`*Home.tsx`、`*Detail.tsx`）与对应的 `@rabjs/react` 状态服务（`*.service.ts`）。
  - `src/components/`：跨领域复用的移动端基础组件（`Screen.tsx`、`BottomSheet.tsx`、`TaskRow.tsx`、`DateField.tsx` 等）。
  - `src/lib/`：API 客户端实例、增量同步（`sync.ts`）、文案（`copy.ts`）、华为推送与 APK 更新桥接封装。
  - `modules/`：本地 Expo 原生模块（`apk-updater`、`huawei-push`、`launcher-badge`）。
- **不放什么**：
  - 不要在 `app/` 路由文件中堆砌业务逻辑、网络请求或复杂样式。
  - 不要在 `src/**/*.ts` 或 `src/**/*.tsx` 中出现任何硬编码的十六进制色值（`#...`）或 `rgba(...)`。

## 开发偏好与局部范式

1. **严禁硬编码颜色（Token 强校验）**：
   - `pnpm --filter @vital/mobile lint:tokens` 会扫描 `src/` 下所有 `.ts/.tsx` 文件，一旦发现 `#hex` 或 `rgba(` 直接报错。
   - 所有颜色必须通过 `@vital/tokens` 与 `src/theme/use-theme.ts`（或 `src/ui/color.ts`）读取语义 Token，确保浅色/深色主题一致。
2. **`@rabjs/react` 服务驱动视图**：
   - 页面状态、分页游标、离线标识与乐观更新统一封装在 `src/features/<domain>/<domain>.service.ts` 的 `Service` 子类中。
   - 页面聚焦刷新结合 `use-focus-reload.ts` 与 `pullSync()`，列表与同步合并收集箱条目时使用 `mergeInboxItems` / `coalesceInboxBody`，防止丢失正文缓存。
3. **私有图片与安全回退**：
   - 直接使用服务端 DTO 返回的 S3 签名 URL 渲染图片，不手动拼接 `/api/v1/uploads/:id`，并处理加载失败时的占位回退。
