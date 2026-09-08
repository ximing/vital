# 扩展收集交互重构：Evernote 式弹窗 — 设计文档

日期：2026-09-08
状态：已获用户批准（方向 + 三模式）

## 背景与问题

当前扩展（`apps/extension`）的收集交互与 Evernote Web Clipper 等成熟产品相比有明显差距：

1. **无工具栏弹窗**：点图标直接静默保存整页，用户没有机会在保存前选择模式、改标题、加备注。
2. **编辑面板是独立 OS 窗口**：「保存并编辑」弹出一个 380×560 的独立窗口（复用 options.html），与页面上下文脱节。
3. **toast 裸 DOM 注入**，4.2 秒消失；图片上传进度用文字刷新（`上传图片 1/5`），反馈模糊。
4. **「最近保存」藏在 action 右键菜单**，几乎不可发现。
5. manifest 契约测试断言「不得使用 default_popup」——这是一期「无弹窗直达保存」的刻意决定，现已推翻。

## 目标

- 工具栏点击 → Evernote 式弹窗：预览 + 模式切换 + 编辑 + 确认。
- 保留静默快存路径（`Alt+Shift+V`、右键直存），两者互补。
- 用弹窗完全取代独立编辑窗口与草稿中转机制。
- 图片转存进度改为弹窗内进度条。

## 非目标

- 截图/可视区域截取模式（后端与交互均可后续再加）。
- 改动 web / mobile 端的 inbox UI。
- 改动后端 API（`createExtensionItem` / `createTask` / 图片转存链路均复用现有接口）。
- 多语言（文案继续中文优先，集中管理于 `i18n.ts`）。

## 交互模型变更

| 入口 | 现状 | 改为 |
|---|---|---|
| 工具栏点击 | 静默直存整页，页内 toast | 打开弹窗（预览+编辑+确认） |
| `Alt+Shift+V`（save-page 命令） | 静默直存 | 不变 |
| 右键直存（页面/链接/选区/图片/待办） | 静默直存 + toast | 不变 |
| 右键「保存并编辑」/ save-and-edit 命令 | 存草稿 → 独立 OS 窗口编辑 | 打开同一弹窗（预填提取结果） |
| 右键「最近保存」（action context） | 独立窗口显示最近 5 条 | 移入弹窗内（次级视图） |
| 未登录时任意保存 | toast「请先登录」+ 打开独立窗口 | 弹窗内引导登录 → 现有网页授权流 |

**删除**：`openPanel()` 独立窗口；options.html 的登录/最近/编辑三视图面板；`draft-store.ts` 草稿中转及 `load-draft` / `clear-draft` / `commit-draft` RPC。

## 弹窗 UI（新 entrypoint：`entrypoints/popup/`）

```
┌──────────────────────────────┐
│ Vital        [文章|选区|待办] │  模式分段控件；有选区时「选区」自动优先
│ ┌──────────────────────────┐ │
│ │ 标题输入（预填解析标题）    │ │
│ │ 站点 · 字数 · 图片数       │ │  元信息行
│ │ 备注 textarea             │ │
│ │ [清单 ▾]（仅待办模式）     │ │
│ └──────────────────────────┘ │
│ [保存]      最近保存 →        │
└──────────────────────────────┘
```

- 打开即自动执行：收集页面 payload（activeTab 已授权）→ offscreen 解析文章 → 预填；解析期间显示骨架态。
- 保存后**不关窗**，切换为成功态：标题 + 「打开」链接 + 图片转存进度条（`2/5`）；失败显示错误 + 重试按钮。
- 三模式：
  - **文章**（默认）：整页解析（复用 `parseInOffscreen` 链路），含图片转存。
  - **选区**：有选中文字时自动优先；取 `selection`，转义为段落 HTML。
  - **待办**：`createTask`，notes = URL + 选区/备注，清单可选。
- 未登录态：弹窗内显示登录引导按钮 → `extensionLoginUrl`（现有网页授权流），不再有邮箱密码表单。

## 技术实现

### 架构

延续现有模式：vanilla DOM + 手写样式，不引入 React。视图状态用纯函数建模（可单测），DOM 渲染薄层。

### RPC 协议（`messages.ts`）

`PanelRequest` 调整：

- 新增 `{ type: 'capture-active-tab' }`：background 收集 payload + offscreen 解析，返回结构化结果（`CapturePayload` 形状 + 解析元信息）。
- 新增 `{ type: 'commit-capture'; title; note; mode; listId?; capture: CapturePayload }`：background 执行创建 + 图片转存。弹窗直接持有完整数据，**无草稿中转**。
- 删除 `load-draft` / `clear-draft` / `commit-draft`；**保留 `exchange-code`**（popup 以标签页打开时的 `?code=` 登录回退路径）。
- 保留：`session` / `logout` / `recent` / `open-web` / `open-login` / `lists`。

### 图片转存进度

`commit-capture` 期间 background 通过 `chrome.runtime.connect` Port 推送进度事件（`{ done, total, failed }`），弹窗渲染进度条。一次性 `sendMessage` 响应不适用于流式进度。静默路径（快捷键/右键）继续用页内 toast。

### 提取逻辑共享

`capture.ts` 中 `saveAndEdit` 与 `savePage` 的提取部分（收集 payload → 解析 → 组装草稿字段）抽成共享函数，供静默路径与弹窗路径复用。

### manifest / wxt.config.ts

- `action.default_popup` → popup 入口（契约测试从「不得有 default_popup」反转为「必须有」）。
- `minimum_chrome_version` 116 → 127（右键「保存并编辑」与 save-and-edit 命令用 `chrome.action.openPopup()` 唤起弹窗；API 不可用或被策略禁用时回退为打开网页版）。
- `web_accessible_resources` 与 options.html 相关条目随面板删除一并清理。

## 改动文件清单

新增：

- `apps/extension/entrypoints/popup/index.html` + `main.ts`
- `apps/extension/src/popup-state.ts`（视图状态纯函数）

修改：

- `apps/extension/wxt.config.ts`（default_popup、chrome 127、清理）
- `apps/extension/src/messages.ts`（RPC 调整）
- `apps/extension/src/client.ts`（`handlePanelMessage` 适配）
- `apps/extension/src/capture.ts`（提取共享函数；删 `openPanel`/`saveAndEdit` 窗口跳转；`handleCommand`/`handleContextMenu` 改道 `openPopup`）
- `apps/extension/src/i18n.ts`（新文案）
- `apps/extension/__tests__/manifest.test.ts`（契约反转）

删除：

- `apps/extension/src/draft-store.ts` 及其测试
- options 入口的登录/最近/编辑三视图（options 回归纯设置页或移除 entrypoint）

## 测试

- `popup-state.ts` 纯函数单测：模式切换、选区优先、加载/成功/失败状态机。
- `capture-helpers` / manifest 契约测试更新。
- `capture.ts` 抽出的提取共享函数单测（mock offscreen 解析）。
- 现有 `capture-helpers.test.ts`、面板相关测试随协议调整同步更新。

## 风险与权衡

- **推翻一期「无弹窗」决定**：快捷键静默快存保留，覆盖不想被打断的场景；这是与用户确认过的方向。
- **`chrome.action.openPopup()` 需要用户手势**：右键菜单点击算手势，命令（键盘快捷键）在多数版本可用；均带回退（静默快存或打开网页版）。
- **popup 生命周期短**（点击别处即关）：保存中误关弹窗会丢失进度。缓解：保存动作先发出请求再渲染成功态；popup 关闭后 background 继续完成转存，进度反馈退化为工具栏 badge（`setBadge`），数据不丢。
