# Vital 产品设计系统与视觉重构方案

> 版本：2.0 · 2026-09-09（取代 1.0 的 Mineral Garden 色板与字号/圆角体系）
> 适用范围：Web、Desktop、Mobile、Extension
> 定位：面向个人的待办、稍后阅读、复盘工具；不是 B 端管理后台。
> 唯一事实来源：`packages/tokens/src/theme.ts` 与 `packages/tokens/src/css/semantic.css`，两者必须同步修改。

## 1. 设计北极星

Vital 的体验是 **Calm Productivity（安静而有行动力的效率）**：打开后有秩序、有呼吸感，用户优先看到"接下来要做什么"，而不是系统本身。视觉主题为 **Emerald Garden（翡翠园）**：暖白纸面、翡翠绿、深墨与暗色下的发光薄荷——杂志式的编辑排版 × 克制的科技感。

四个视觉关键词：**Editorial / Calm / Focused / Luminous**。

### 必须遵守

- 内容先于容器：待办、阅读、复盘条目都是可直接操作的"信息行"，不是 Card 列表。
- 结构靠**字重对比、eyebrow 标签、发丝线（1px hairline）和疏密节奏**建立；边框只用于输入、浮层、面板分界和报告纸卡。
- 只使用一个品牌强调色：翡翠绿。完成、逾期、优先级等是语义色，不能冒充第二品牌色。
- 杂志感来自排版细节（Sora 标题、宽字距 eyebrow、mono 数字），**不靠大字号**——正文 14px，信息密度优先。
- 状态有意义但不制造焦虑：逾期只着色日期、分组眉或 checkbox 描边，绝不把整条任务染红。

### 明确避免

- 灰绿糊成一团的"粉笔灰"色板；相邻层级亮度差 < 5% 的暗色"泥灰"。
- 近黑 + 金黄的夜店感；纯黑 OLED 底；高饱和"成功绿"。
- 到处都有阴影、渐变、KPI 大数字卡；P1/P2 彩色大 Badge；过度游戏化的动效。
- 用 24px+ 大标题制造"设计感"而牺牲列表密度。

## 2. 信息与版式框架

构图逻辑不变：**Rail（工具书脊） → Library（个人索引） → Focus Canvas（当前工作） → Detail（按需出现）**。任何时刻只有一个视觉主角。

```text
┌───────┐ ┌──────────────────────┐ ┌──────────────────────────────────────────┐ ┌──────────────┐
│ Rail  │ │ Library              │ │ Focus Canvas                             │ │ Detail       │
│ 56px  │ │ 248px, 可调宽        │ │ 当下的一件事：今天 / 阅读 / 复盘 / 搜索    │ │ 400px, 按需  │
└───────┘ └──────────────────────┘ └──────────────────────────────────────────┘ └──────────────┘
```

### 面板分层（2.0 更新）

- 三个纵向区域同色系，**只靠 1px 发丝线（`border-subtle`）分界**：Rail `border-r`、Library `border-r`、Detail `border-l`。不用色块、不用阴影区分面板。
- Rail：56px，仅图标；选中项 `bg-accent-subtle` + 主色图标 + 左侧 3px 圆角指示条。
- Library：导航项行高 40px、`radius-md`；选中项 `bg-accent-subtle` + 主色文字 500 字重；计数用 mono `text-tertiary`，不做色块 badge。
- Focus Canvas 外层 padding：桌面 `24–32px`（`px-6 md:px-8`）；搜索/设置等文档型页面内容列**居中收窄**（`max-w-2xl mx-auto`）；阅读/复盘正文 680–720px。绝不拉满宽屏。

### 栅格与间距

基础 4px：`4 / 8 / 12 / 16 / 20 / 24 / 28 / 32 / 40 / 48 / 56`（2.0 补了 28 与 56）。

- 疏密节奏：**组内密、组间疏**。列表行紧凑，分组之间 `pt-6`（24px）；页面标题与首块内容 16–20px；区块之间 24–28px。
- 页面级 padding 加大换"呼吸感"，但列表行高不膨胀。

## 3. 色彩系统

### 3.1 品牌色：翡翠绿 / 发光薄荷

| Token | Light | Dark | 用途 |
|---|---:|---:|---|
| `accent.primary` | `#1C7A4F` | `#5FD3A1` | 选中、链接、主强调；暗色为高明度"发光"薄荷 |
| `accent.hover` | `#155E3D` | `#82E0B6` | hover / pressed |
| `accent.deep` | `#155E3D` | `#5FD3A1` | 实心主按钮（配 `on-accent` 文字） |
| `accent.subtle` | `#DFEDE4` | `#1B2E24` | 选中导航、tag 胶囊、focus 背景 |
| `accent.on-primary` | `#FFFFFF` | `#0B1611` | 主按钮文字 |
| `focus.ring` | `rgb(28 122 79 / 16%)` | `rgb(95 211 161 / 22%)` | `0 0 0 3px` 焦点环 |

品牌色预算：一个页面除 checkbox / 选中态外，最多一个实心 Primary Button。品牌色可用于 eyebrow 强调色和 tag 胶囊文字，但不做整块背景。

### 3.2 语义表面与文字

| Token | Light | Dark | 角色 |
|---|---:|---:|---|
| `bg.canvas` | `#F3F5F2` | `#0F1210` | 应用画布；暗色是中性暖墨，不是泥绿 |
| `bg.surface` | `#FAFBF9` | `#161A17` | 面板、导航、详情 |
| `bg.surface-muted` | `#EBEEE9` | `#1D221E` | hover、分段控件底 |
| `bg.elevated` | `#FFFFFF` | `#232925` | 浮层、报告纸卡、选中行 |
| `text.primary` | `#1B211D` | `#ECEFEB` | 标题、任务名、正文 |
| `text.secondary` | `#555E56` | `#A4ACA1` | 说明、项目、日期 |
| `text.tertiary` | `#98A098` | `#798174` | placeholder、mono 计数、极弱信息 |
| `border.subtle` | `#E2E6E0` | `rgba(255,255,255,0.08)` | 发丝线、输入与浮层边界；暗色用半透明白，叠加更自然 |
| `overlay.scrim` | `rgb(27 33 29 / 32%)` | `rgba(0,0,0,0.52)` | Modal 覆层 |

暗色主题不是亮色反转：面板三层梯度（`surface → muted → elevated`）要明显拉开；主色换高明度发光色；普通内容区不用阴影，浮层用双层阴影：
`--shadow: 0 1px 2px + 0 10~12px 28~32px`（light 5–7% 墨绿，dark 30–42% 黑）；`--shadow-xs: 0 1px 2px` 用于输入条、小卡片。

### 3.3 功能色

| Token | Light | Dark | 使用方式 |
|---|---:|---:|---|
| `status.done` | `#2F9E63` | `#63C78D` | 已完成 |
| `status.doing` | `#3D6FD1` | `#6FA0EE` | 进行中、今天的时间 |
| `status.due-soon` | `#B4761E` | `#E0A94E` | 临近截止 |
| `status.favorite` | `#D9A62E` | `#F2CC6B` | 收藏星标专用：比 due-soon 更浅更黄的金色，不表示时间状态 |
| `status.overdue` / `danger` | `#CE4A45` | `#E8756C` | 逾期、破坏性操作 |
| `report.*` | `#1C7A4F / #155E3D` | `#5FD3A1 / #82E0B6` | 复盘周期强调，取自品牌色族 |
| `src.*`（收集来源） |  muted 紫/绿/蓝/琥珀/青 | 对应提亮 | 仅 24px 来源 tile，不扩散 |

语义色背景统一用 token 的 10–15% 透明度混合生成，不另造高饱和状态底。

## 4. 字体、字级、圆角与动效

### 字体栈（2.0 起 Sora 承担展示层）

- `--font-sans`：Inter + PingFang SC 等——正文与 UI。
- `--font-display`：**Sora** + 中文回退——页面标题、报告标题、统计数字；统一 `letter-spacing: -0.02em`（工具类 `.font-display`）。
- `--font-mono`：ui-monospace——**日期戳、计数、时间**等数字类 metadata（科技感细节来源）。

### 字级（克制版编辑梯度）

| 层级 | 尺寸/行高 | 字重 | 用途 |
|---|---|---|---|
| Display | 26 / 34 | 700，Sora | 页面唯一主标题 |
| Title | 20 / 28 | 600–700，Sora | 卡片/详情标题、统计数字 |
| Section | 16 / 24 | 600 | 区块标题（少用） |
| Body | 14 / 21 | 400，标题 500 | 正文、任务标题 |
| Meta | 13 / 18 | 400–500 | 辅助说明 |
| Caption | 12 / 16 | 400–650 | metadata、eyebrow |
| **Eyebrow** | 11px / 650 / +0.09em / 大写 | 650 | 分组眉（工具类 `.eyebrow`） |

**Eyebrow 是杂志感的核心手法，零空间成本**：分组标签用 `.eyebrow`；需要分隔时加 `.eyebrow-rule`（文字后跟随 1px 发丝线）。强调态 `.eyebrow-accent`（主色，如"置顶"）、`.eyebrow-danger`（如"已过期"）。

### 圆角与控件

`--radius-sm: 6 / md: 10 / lg: 14 / xl: 20 / pill: 999`。

| 元素 | 规格 |
|---|---|
| 导航项 / 按钮 / 输入框 | h 36–40，radius-md |
| 任务行 / 列表行 hover | radius-lg（14） |
| QuickAdd 条 / 搜索框 | h 46，radius-lg，**白底（surface）+ 1px 描边 + `--shadow-xs`**，focus 边框变主色 + focus ring |
| 报告纸卡 / 设置区块卡 | radius-xl（20）或 18，描边 + `--shadow` |
| 浮层 / 弹窗 / 命令面板 | radius-xl，描边 + `--shadow`（`FIELD_POPOVER_CLASS`） |
| tag / 类型 chip / 状态 chip | **pill 胶囊**：`bg-accent-subtle` + 主色文字 500 |
| checkbox | 18–20px 圆形，**1.5px 描边**（默认 `text-tertiary` 色，保证可见），完成填充 `status.done` |

### 动效

- `120ms` 颜色/hover；`180ms` popover/行展开；`240ms` 侧栏与详情面板。easing `cubic-bezier(0.2, 0, 0, 1)`。
- 尊重 `prefers-reduced-motion`；完成 checkbox 轻微 scale 反馈。

## 5. 跨模块组件标准

### 页面头（文档型页面）

```text
26px Sora 标题   YYYY-MM-DD · WED（mono caption，tertiary）        ⋯
```

主标题 + mono 日期戳同行 baseline 对齐，是"今天"类页面的固定头部。

### 分组眉（列表分节）

```text
⌄ 置顶  2 ───────────────────────────────（发丝线）       顺延（可选动作）
```

`.eyebrow eyebrow-rule`：chevron 12px + 标签 + mono 计数 + 发丝线；置顶用 accent、已过期用 danger。

### 任务行

- padding `10px 12px`，radius-lg；hover/选中用 `bg-surface`（选中可用 `bg-surface-muted`）。
- 标题 14px/500；右侧 metadata 轨道 `caption + tabular-nums`；逾期红、今天蓝、临近琥珀。
- tag 用 pill 胶囊（最多 3 个，其余 +N）；快捷操作 hover 才出现。

### 输入与浮层

- 所有文本输入复用 `FIELD_CONTROL_CLASS`：白底 + 1px 描边 + `--shadow-xs`，focus 主色边框 + 3px 光圈。
- 所有弹层复用 `FIELD_POPOVER_CLASS`：radius-xl + 描边 + `--shadow`。
- **弹层朝向**：触发器靠近容器右缘时必须 `align="end"`（right-0），否则会被 `overflow:hidden` 的主区裁掉。

### 按钮

- Primary：`accent.deep` 实底 + `on-accent` 文字 + `--shadow-xs`，每局部至多一个。
- Ghost：`accent.subtle` 底；Quiet：透明底 hover 才出 muted；Danger：描边 + 浅底，确认前不实心红。

## 6. 场景落地规范

### 6.1 待办

- 列表/看板/周视图切换收进 `⋯` 菜单；分组用 eyebrow-rule；快速添加紧贴页头。
- 详情面板 400px：左发丝线；顶部工具行（checkbox、日程、优先级、清单、更多、关闭）；标题 Sora 20/700；标签胶囊 + 虚线描边添加胶囊；"备注/子任务" eyebrow-rule 分节；子任务用描边画布底卡片。

### 6.2 稍后阅读（2026-09-09 按实现回写）

- 预览列表是 Focus Canvas 的主角并**始终贴左**：`/inbox` 与 `/inbox/:id` 共用同一列表列，打开文章不跳动；未选中时右侧为 EmptyReader 占位。列宽默认 360px，可拖拽 320–520px（`vital:pane-width:inbox-list`，复用 chrome.ts 宽度持久化模式）。
- Library 的「收集」section 只做**筛选索引**：全部/未读/收藏/归档 + mono 计数，筛选用 `?filter=` query 表达，不做常驻列表。
- 列表行：标题 14px/**600**；已读/未读靠颜色（text-secondary / text-fg）+ 主色未读圆点区分，不靠字重；时间戳**右对齐** mono tabular-nums；来源 24px tile（`--src-*` 仅限 tile）；收藏是**实心星**（`--status-favorite`）；归档/已转任务用 pill chip（标题行内）；收藏/归档快捷操作 hover 才浮出。
- 日期分组眉 eyebrow-rule：今天/昨天/本周/更早 + mono 计数；新建入口是 header 右侧「+」弹浮层（fixed 定位、align=end 防裁剪），无常驻输入框。
- Reader：工具行 sticky **无分割线**（bg-canvas/90 + blur 分层），顶部 2px 主色**滚动进度线**；标题块 = Sora 标题 → 来源 meta 行 → 原文链接行（truncate + 复制按钮，复制成功 1.5s 对勾反馈）。
- 阅读列响应式：`max-w 700px / 840px(xl) / 920px(2xl)`，工具行与正文同宽。
- 正文字级（`.reader-article`）：md **15.5px/1.8**（sm 14/1.75、lg 17/1.8），段落间距固定 18px，文内标题用 Sora（h1 22/30、h2 20/28、h3 16/24），blockquote 2px 主色左边线。

### 6.3 复盘

- kicker 一行 eyebrow-accent + 发丝线（如"把完成的事留下痕迹"），右侧对齐保存状态（mono caption）。
- 标题 26px Sora + 左侧 4px 主色竖条；标题行右侧放**周期切换胶囊分段控件**（日/周/月/年，同设置页 tab 模式），Library 导航仍是入口。
- meta 行：mono 周期范围（日报 `YYYY-MM-DD`，周报 `起 – 止 · W{ISO周数}`，月/年紧凑格式）+ **行内统计**（语义色 6px 圆点 + Sora 20px 数字 + caption 标签），不做 KPI 大数字卡堆叠。
- 回顾列表（完成/结转/收集）**去卡片化**：eyebrow-rule + chevron 可折叠分节，信息行直接落在画布上；报告纸卡是页面唯一卡片。
- 报告纸卡：`bg-elevated` + 1px 描边 + radius-xl + `--shadow` + 顶部 3px 主色渐变发丝线（`.report-paper`）。
- 编辑器排版（`.report-doc`）：正文 14px/1.75；纸卡 padding 24/28/32；正文栏宽 680px（子元素限宽，编辑器点击区保持满宽）；h1 用 Display，h2/h3 用 Section 16/24（`--text-section`）；段距 0.45em，靠行高保持呼吸。
- 右侧日历/统计栏 320px，`bg-surface` + 左发丝线，是上下文不是主角；日历与统计各配一条 eyebrow-rule 分组眉（往期 / 周期统计）。
- **日历热力刻度**：日粒度用绝对刻度 `fill = 18% + 62% × min(n, 5) / 5`（完成 1 件 ≈ 30% 淡洗，5+ 饱和 80%）——选中日独享 100% 实心主色，热力日永不相撞；今天 = 热力底 + 主色描边环 + wrote 小点叠加。月/年粒度是聚合计数，保持相对归一化。
- 移动端：上下文栏沉到正文之后（DOM 序即视觉序），书写面优先。

### 6.4 设置与搜索

- 内容列 `max-w-2xl mx-auto` 居中；标题 26px Sora。
- 设置 tab 用胶囊分段控件（`bg-surface-muted` 槽 + 选中 `bg-elevated` 浮起）；区块卡 radius 18 + 描边 + `--shadow-xs`。

## 7. Token 工程规范

- 组件**禁止直接引用 hex**；`@vital/tokens` 是唯一色彩来源。
- `theme.ts`（TS/RN 端）与 `css/semantic.css`（Web CSS 变量）必须同步修改；`packages/tokens/__tests__` 锁定关键值。
- 例外：字号刻度（`--text-caption/meta/body/section/title/display`）只存在于 `semantic.css`，`theme.ts` 无字号表，新增字号 token 只改 CSS 一处即可。
- Web 端 Tailwind 映射在 `apps/web/src/styles/app.css` 的 `@theme` 块；语义工具类（`.eyebrow`、`.eyebrow-rule`、`.font-display`、`.report-paper`）也定义在这里。
- 共享样式类集中在 `apps/web/src/ui/`：`FIELD_CONTROL_CLASS`、`FIELD_POPOVER_CLASS`、`Button` variant、`RAIL_NAV`/`railNavClass`。

## 8. 验收清单

- [ ] Light / Dark 面板层级一眼可辨；暗色不是亮色反转（发光主色、半透明边框、拉开的三层梯度）。
- [ ] 翡翠绿是唯一品牌强调色；每页至多一个实心主按钮。
- [ ] 列表分组全部使用 eyebrow（± 发丝线），没有"16px 粗体 + 灰字"的旧式分组头。
- [ ] 页面主标题 26px Sora；数字类 metadata 用 mono/tabular-nums。
- [ ] 输入、浮层、按钮全部复用 `ui/` 共享类，无局部重写。
- [ ] 触发器靠右的弹层全部 `align="end"`，无裁剪。
- [ ] 任务、阅读、复盘条目默认不是 Card；报告纸卡和设置区块卡是仅有的"卡片"。
- [ ] hover / focus-visible / reduced-motion 等价可用；对比度 WCAG AA。
