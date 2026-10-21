---
paths:
  - "packages/tokens/**/*"
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/styles/**/*.css"
  - "apps/mobile/src/**/*.tsx"
  - "apps/mobile/src/**/*.ts"
---

# Emerald Garden 设计系统与 UI 实现规范

## 1. 设计 Token 唯一事实源（双改原则）

- 色彩、字级、圆角、阴影的唯一事实源位于 `packages/tokens`。
- 修改或新增任何设计 Token 时，**必须同步修改** `packages/tokens/src/theme.ts` 与 `packages/tokens/src/css/semantic.css`，确保 Web CSS 变量与 React Native / JS 主题对象完全一致。
- 在 `apps/mobile/src/` 中严禁硬编码 `#hex` 或 `rgba(...)`（由 `pnpm --filter @vital/mobile lint:tokens` 强制检查）。

## 2. 版式结构与 Calm Productivity 视觉原则

- **工作区骨架（Web）**：保持 `Rail → Library → Focus Canvas → Detail` 四栏秩序；`library` 与 `canvas` 必须设置 `min-h-0 flex-1` 以填满可用高度。
- **内容先于容器**：待办、稍后读、复盘条目均以可直接操作的“信息行”呈现，不堆砌卡片边框；面板与主表面之间仅靠 1px 发丝线（`border-subtle`）、背景层级（`canvas / surface / surface-muted / elevated`）和疏密间距表达结构。
- **克制使用状态色**：翡翠绿是唯一品牌强调色（单页面除选中态/复选框外最多一个实心主按钮）。逾期状态只着色日期、分组眉（`.eyebrow-danger`）或复选框描边，**绝不把整条任务行染红**。
- **字体分工**：页面主标题与统计数字使用 `--font-display`（Sora），日期戳、计数、时间等元数据使用 `--font-mono`，分组眉使用 `.eyebrow`。

## 3. 通用控件与图片回退

- **日期与时间控件（Web）**：必须复用 `apps/web/src/ui/field.tsx` 中的 `FIELD_CONTROL_CLASS` 与 `FIELD_POPOVER_CLASS`，保持统一的高度、圆角、焦点环与弹层行为。
- **私有图片安全回退**：图片只渲染业务 DTO 中的服务端签名 URL；图片加载失败时必须回退到安全的本地占位内容（如用户头像回退为显示名首字母）。
