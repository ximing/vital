# `@vital/extension` — 浏览器扩展指令

## 这个目录负责什么

- 基于 WXT 构建的 Chrome MV3 浏览器扩展，用于将当前网页、选中文本或图片一键保存到 Vital 稍后读（Inbox）或待办（Tasks）。

## 放置约束

- **放什么**：
  - `entrypoints/`：WXT 扩展入口（background service worker、content script、popup 页面）。
  - `src/`：页面正文抽取、选区转换、扩展端存储、Bearer 鉴权状态与 API 调用逻辑。
  - `__tests__/`：扩展抽取逻辑与交互的 Vitest 测试。
- **不放什么**：
  - 不要在扩展内重复实现通用的 HTML 清洗或 ArticleDoc 转换算法，应复用 `@vital/article-extract`、`@vital/article-html` 与 `@vital/article-doc`。

## 开发偏好与局部范式

1. **鉴权机制**：
   - 扩展不依赖浏览器 Cookie 鉴权，而是通过 Web 端 `/auth/extension` 签发一次性授权码并换取 Bearer Token。
2. **构建与检查前置步骤**：
   - 运行类型检查或 ESLint 前需要生成 WXT 类型声明（`pnpm --filter @vital/extension typecheck` 与 `lint` 脚本已内置 `wxt prepare`）。
