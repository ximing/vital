# Vital 产品设计系统与视觉重构方案

> 版本：1.0 · 2026-09-06
> 适用范围：Web、Desktop、Mobile、Extension
> 定位：面向个人的待办、稍后阅读、复盘工具；不是 B 端管理后台。

## 1. 设计北极星

Vital 的体验应是 **Calm Productivity（安静而有行动力的效率）**：打开后有秩序、有呼吸感，用户优先看到的是“接下来要做什么”，而不是系统本身。视觉主题定为 **Mineral Garden（矿物植物感）**：石灰岩、苔藓、鼠尾草与深墨色构成安静、有生命力的个人工作室。

四个视觉关键词：**Clean / Calm / Focused / Modern**。

### 必须遵守

- 内容先于容器：常规待办、阅读条目和复盘条目都是可直接操作的“信息行”，不是 Card 列表。
- 通过间距、文字层级、低对比背景建立结构；边框只用于输入、浮层和必要的分隔。
- 只使用一个品牌强调色：灰掉的鼠尾草绿（Sage）。完成、时间、优先级等是语义色，不能冒充第二品牌色。
- 圆角克制，默认 8px；禁止把页面、列表行、按钮全部做成药丸或 20px 以上大圆角。
- 状态有意义，但不制造焦虑：逾期只着色日期或小图标，绝不把整条任务染红。

### 明确避免

- 近黑 + 金黄的夜店感；纯黑 OLED 背景；纯白铺满屏幕；高饱和的“绿色按钮”。
- 到处都有阴影、分割线、统计卡片和渐变。
- 明亮的红、黄、绿同时抢注意力；过度可爱或游戏化的动效。

## 2. 信息与版式框架：Mineral Garden 工作台

参考稿的价值不在于“把界面做成海报”，而在于它用大留白、编辑排版与自然材质形成了清晰的主次。Vital 采用同样的构图逻辑：**Rail（工具书脊） → Library（个人索引） → Focus Canvas（当前工作） → Detail（按需出现）**。功能很多，但任何时刻只能有一个视觉主角。

```text
┌───────┐ ┌──────────────────────┐ ┌──────────────────────────────────────────┐ ┌──────────────┐
│ Rail  │ │ Library              │ │ Focus Canvas                             │ │ Detail       │
│ 56px  │ │ 248px, 可收起        │ │ 当下的一件事：今天 / 阅读 / 复盘 / 项目    │ │ 400px, 按需  │
│       │ │ 当前路径才完全展开   │ │ 有最大内容宽度，不拉成全幅仪表盘          │ │ 选中才打开   │
└───────┘ └──────────────────────┘ └──────────────────────────────────────────┘ └──────────────┘
```

| 区域 | 职责 | 视觉规则 |
|---|---|---|
| Rail | 在节奏、收集、清单、复盘间切换 | 56px，像一本书的书脊；仅图标；选中用 3px 鼠尾草绿左标记；不使用色块按钮 |
| Library | 当前模块的目录、筛选、项目树与阅读队列 | 248px（224–264px 可 resize）；像索引页，不像后台导航；只展开当前路径，非当前分组降低对比度 |
| Focus Canvas | 任务、文章或复盘的主叙事 | 弹性宽度但内层最大 920px；主内容左对齐、留出右侧呼吸区；标题与内容形成单一垂直阅读流 |
| Detail | 一条任务/文章/复盘的编辑上下文 | 400px；仅在选中对象时打开；不选中时完全收起，不留空白占位 |

### 栅格、留白与材质

基础单位为 4px：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48`。

- Focus Canvas 外层 padding：大桌面 `40px 48px`，常规桌面 `32px`，紧凑桌面 `24px`，移动端 `16px`。
- Canvas 的正文列最大 760px；任务清单可到 920px；复盘正文 680–720px；阅读正文 640–700px。绝不把一行文字拉满宽屏。
- 页面标题与第一块内容：24px；区块之间：32px；区块标题与内容：8px。空白服务于阅读节奏，而不是让对象漂散在画布中央。
- 自然材质只作为低频气候：空状态、onboarding、复盘封面或 Library 底部 80–120px vignette。只允许一张低对比图像，叠加 `bg.app` 的 20–40% 色罩；任务工作区、表单和列表不放装饰图。

### 自适应与折叠规则

| 宽度 | 布局 | 行为 |
|---|---|---|
| ≥ 1440px | Rail + Library + Canvas + 可选 Detail | Canvas 保持最大内容宽度；Detail 只有选中对象时出现 |
| 1024–1439px | Rail + Library + Canvas | Detail 改右侧 overlay；Library 可收窄至 224px |
| 768–1023px | Rail + Canvas | Library 作为左侧 sheet；页面顶部显示当前路径与项目切换 |
| < 768px | 单列 Canvas | Rail 收进底部/菜单；Library 与 Detail 都为全屏 sheet，信息层级不改变 |

### 四个核心页面的版式

#### 今天：一天的执行页

```text
小日期 / 星期 / 可选的一句上下文                  [列表 | 看板 | 日历] [筛选]
今天  ·  6 Sep

[ + 添加任务…                                                        ]

上午
○ 写设计规范                                    项目 · 10:00          ⋯
○ 处理阅读清单                                  今天                  ⋯

稍后
○ 整理项目结构                                  个人                  ⋯

已完成  3                                                     展开
```

- 这是清单页，不是 dashboard：无 KPI 卡、无大面积 hero、无常驻装饰图。
- 日期作为 12px 的 editorial eyebrow；`今天` 是唯一 24px 页面标题。顶部操作收在同一行右侧。
- 快速添加紧贴标题区，随后直接进入任务节奏。任务组使用文字和留白分隔，而不用框线。
- 右侧的自然材质只可在没有任务的空态中出现，尺寸不超过 Canvas 的 28%。

#### 项目与多级目录：个人索引页

```text
Library
⌄ 工作                                      8
  ⌄ 产品改版                                5
      官网视觉系统                           3
        图片与文案                           1
  设计素材                                  3
⌄ 个人                                      4

Focus Canvas
产品改版                     5 个未完成 · 最近编辑于今天
项目说明（可选，一行）
──────────────── 任务信息行 ────────────────
```

- 项目树驻留在 Library；Canvas 只展示当前项目及其任务，不在两个区域重复完整层级。
- 目录是逐级缩进的索引，而非嵌套卡片。展开路径以 `accent.subtle` 的极弱底色提示；无关分组保持 secondary/tertiary 文字。
- 项目封面不用大 Banner。允许 24px 小型植物/矿石 line icon，或在项目为空时出现一张无文字的低对比 vignette。

#### 稍后阅读：阅读队列与专注阅读面

```text
Library                         Focus Canvas
收集                            稍后读                         [筛选]
输入链接… [预览]                12 篇待读 · 2 篇本周完成
未读  12
阅读中 3                         [favicon] 文章标题两行
已读  28                                    来源 · 6 分钟 · 主题
                                 [favicon] 下一篇文章……
```

- 队列仍是信息行；缩略图可选且固定 40px，不能让每篇文章变成媒体 Card。
- 点开文章后 Canvas 切为 `640–700px` 阅读列；工具与元信息退到页头，阅读进度是一根 2px 植物灰线。
- 收藏、归档、转任务隐藏在 hover/更多菜单。阅读本身是主角，不让控制器包围文章。

#### 复盘：有节奏的反思页

```text
Library                    Focus Canvas
日报                      2026 年 9 月 6 日
周报                      完成 8 · 写下 1 · 结转 2
月报
年报                      今天完成的事
                          - ……

                          我注意到……
                          [可编辑正文]

                         （小型热力日历 / 周期跳转，仅作上下文）
```

- 复盘的主画面是书写面，不是统计面板；数据在标题下以一行 metadata 摘要呈现。
- 日历放在 Library 末端或 Canvas 侧上方，宽度不超过 280px，作为导航和上下文，不能与正文争夺焦点。
- 复盘封面是唯一可更具材质感的页面：允许极淡的石材/苔藓图像，但只在未开始书写或周期概览中出现，编辑时自动退场。

## 3. 色彩系统

### 3.1 品牌色

选择灰掉的植物色，而不是常见的“成功绿”：`#697C65` 更接近苔藓、叶片背面与石材上的植物痕迹。它为安静的任务管理提供可辨识的生命力，但不把界面变成健康/环保产品。

| Token | Light | Dark | 用途 |
|---|---:|---:|---|
| `accent.primary` | `#697C65` | `#A0B497` | 选中、完成、非危险的主强调 |
| `accent.hover` | `#425246` | `#B7C8AF` | hover / pressed |
| `accent.deep` | `#425246` | `#A0B497` | Light 主按钮、深强调文本；Dark 主按钮 |
| `accent.subtle` | `#DCE3D7` | `#303B2F` | 选中导航、轻提示、focus 背景 |
| `accent.on-primary` | `#FFFFFF` | `#191C19` | 主按钮 / 完成 checkbox 内文字 |
| `focus.ring` | `rgb(105 124 101 / 20%)` | `rgb(160 180 151 / 24%)` | `0 0 0 3px` 焦点环 |

品牌色的预算：一个页面中，除 checkbox / 小型选中状态外，最多存在一个实心 Primary Button。浅色主题的实心主按钮使用 `accent.deep`，而不是较浅的 `accent.primary`，保证白字对比度；深色主题使用 `accent.deep`（即 `#A0B497`）配深墨文字。品牌色不能用于普通标签、标题装饰、整块背景或所有图标。

### 3.2 语义表面与文字

| Token | Light | Dark | 角色 |
|---|---:|---:|---|
| `bg.app` | `#F3F3ED` | `#191C19` | 应用画布：石灰岩 / 深墨植物灰 |
| `bg.surface` | `#FAFAF6` | `#20231F` | 内容区、主阅读面 |
| `bg.surface-muted` | `#EAECE4` | `#292D27` | hover、输入、次级导航 |
| `bg.elevated` | `#FFFFFF` | `#30342F` | 菜单、弹窗、命令面板 |
| `text.primary` | `#272B27` | `#EDEEE8` | 标题、任务名、正文 |
| `text.secondary` | `#697067` | `#A8ADA3` | 项目、日期、说明 |
| `text.tertiary` | `#969B91` | `#777D74` | placeholder、禁用、极弱信息 |
| `border.default` | `#DEE0D9` | `#393E37` | 输入、浮层与必要边界 |
| `overlay.scrim` | `rgb(39 43 39 / 28%)` | `rgb(0 0 0 / 48%)` | Modal 覆层 |

深色主题不是反转浅色主题，也不是黑灰主题。层次顺序固定：`app → surface → muted → elevated`，每一层都带极轻的植物灰，越接近用户的浮层亮度越高。普通内容区不使用阴影；浮层在浅色用 `0 4px 16px rgb(39 43 39 / 6%)`，深色主要靠色阶、辅以 `0 12px 32px rgb(0 0 0 / 28%)`。

### 3.3 功能色

| Token | Light | Dark | 使用方式 |
|---|---:|---:|---|
| `state.success` | `#45A36B` | `#65C58A` | 已完成图标、正向提示 |
| `state.warning` | `#B97922` | `#E3AE55` | 临近截止、需注意 |
| `state.error` | `#C95454` | `#EB7777` | 逾期日期、破坏性反馈 |
| `state.info` | `#4D82D8` | `#6FA0EE` | 信息提示、外部链接 |
| `priority.p1` | `#C95454` | `#EB7777` | flag，不超过 16px |
| `priority.p2` | `#B97922` | `#E3AE55` | flag，不超过 16px |
| `priority.p3` | `#4D82D8` | `#6FA0EE` | flag，不超过 16px |
| `priority.p4` | `#999BA1` | `#73757D` | flag，不超过 16px |

语义色的背景统一通过 `color-mix(in srgb, token 12%, bg.surface)` 生成；不要另造高饱和状态背景。

## 4. 字体、尺寸、圆角与动效

### 字体

字体栈：`Inter, PingFang SC, Hiragino Sans GB, Noto Sans SC, Microsoft YaHei, sans-serif`。现有 Sora 可仅用于英文品牌字标；不应成为中文任务正文的主字体。

| 层级 | 尺寸 / 行高 / 字重 | 用途 |
|---|---|---|
| Display | 28 / 36 / 600 | 欢迎、少量大标题 |
| Page title | 24 / 32 / 600 | 今天、稍后读、复盘 |
| Section title | 16 / 24 / 600 | 上午、最近完成 |
| Task title | 15 / 22 / 400–500 | 任务与文章标题 |
| Body | 14 / 22 / 400 | 编辑器、说明 |
| Metadata | 12–13 / 18 / 400–500 | 时间、项目、标签 |

### 控件与圆角

| 元素 | 高度 / 尺寸 | Radius |
|---|---:|---:|
| Rail 图标按钮 | 36 × 36px | 8px |
| 导航 item | 36–40px | 8px |
| Task row | 44–48px；扩展行 56–68px | 8px（只用于 hover） |
| Button / Input | 36px 常规，40px 主操作 | 8px |
| Tag / 小按钮 | 24–28px | 6px |
| Card / Calendar pane | — | 12px |
| Modal / Command palette | — | 16px |

不要使用 `rounded-2xl` 作为默认类；药丸仅用于极少数的状态开关或计数器。

### 动效

- fast `120ms`：颜色、hover、icon；normal `180ms`：popover、行展开；slow `240ms`：侧栏与详情面板。
- easing：`cubic-bezier(0.2, 0, 0, 1)`。
- 完成 checkbox：`160–220ms`，轻微 `scale(.92) → scale(1)`，任务文字降至 secondary 并加删除线；默认保留在当前列表，直到用户切换或撤销。
- 尊重 `prefers-reduced-motion`；拖拽仅移动对象本身，不让整页大幅跳动。

## 5. 跨模块组件标准

### Sidebar 与三级/四级目录

层级必须由 **缩进 + 图标 + 字重/文字色** 表达，不能用连续 Card 包裹。

| 层级 | 缩进（相对侧栏内边距） | 字重/颜色 | 展开交互 |
|---|---:|---|---|
| L1：空间 / 主清单 | 8px | 500 / primary | chevron + 目录图标 |
| L2：项目 / 分组 | 28px | 400 / primary | chevron；可显示 12px 计数 |
| L3：子项目 / 列表 | 48px | 400 / secondary | hover 才显更多菜单 |
| L4：归档分类 / 子清单 | 68px | 400 / secondary | 仅在展开父级时渲染 |

- 每行 32–36px；仅选中项使用 `accent.subtle` 背景、`accent.primary` 图标和 8px 圆角。
- 未选中项 hover 用 `bg.surface-muted`。禁止对整个父级目录加边框或背景块。
- L4 是视觉与认知上限；若需要更多层级，改用标签、筛选或项目属性。
- 目录计数采用 `text.tertiary`，不做色块 badge；仅“今天逾期”可用 error 色数字。

### Task list

```text
[checkbox 20]  [任务标题 / 可选描述]            [日期 · 项目 · 标签] [快捷操作]
```

- 行内 padding `10px 12px`，gap `12px`。常规行不设 divider；同一分组的最后一项后留 12px。
- checkbox 20px，未完成透明填充 + `1.5px border.default`；hover 变为 `accent.primary` 边框；完成填充 `accent.primary`。
- 标题先于状态：任务名 `text.primary`，日期/项目/标签在同一低权重 metadata 轨道。窄屏时 metadata 下移，不能挤压标题。
- 快捷操作（日程、优先级、更多）默认隐藏，仅 hover 或键盘 focus-within 出现；触屏端放进更多菜单。
- 优先级使用 14–16px flag / dot；不要做 P1/P2 彩色大 Badge。
- 标签：`12px/18px`、6px radius、中性轻背景；最多常驻两个，其余 `+N`。

### Quick add 与输入

快速新建在静止时应像一行可输入的内容，而不是厚重搜索框：`40px`、`bg.surface-muted`、无明显阴影；聚焦后使用 `bg.surface + border.default + focus ring`。只在输入解析出日期、项目、标签时显示轻量 chips。

### Button、菜单与图标

- Primary：Light 使用 `#425246` 实底配白字；Dark 使用 `#A0B497` 实底配 `#191C19` 文字；每个局部仅一个。
- Secondary：`bg.surface` + 必要时 `border.default`；Ghost：透明底、hover 才有 muted 背景。
- Danger 只在不可逆动作中出现，确认前不使用实心红按钮。
- 图标统一 Lucide/Phosphor Regular 的 outline，16/18/20px，stroke 1.5–1.75px；只在选中、完成、收藏中允许 filled。

## 6. 三个核心场景的落地规范

### 6.1 待办：执行，而非“任务仪表盘”

- 今日页顶部仅保留小型问候/上下文、`24px` 标题、视图切换和筛选；把现有过于宽大的快速添加框收进 `max-width: 920px` 内容列。
- List / Board / Calendar 作为分段控件，36px 高、8px radius，选中项用 `bg.surface` + 轻阴影或 `accent.subtle`，不要整块金色。
- 分组标题（今天、上午、无日期）16px/600；完成数量可作 secondary 文本，不做 KPI 卡。
- 看板只有列容器使用 surface/card；卡片内部保持信息行密度，列之间 16px gap。日历仅日期选中和事件点使用品牌色。
- 任务详情是编辑上下文：标题、日期、项目、优先级、标签按纵向信息流排布；属性控件用 ghost/quiet 行，不做一排圆角胶囊。

### 6.2 稍后阅读：像安静的阅读队列

- 收集区保留 URL 输入与“预览”，但把当前整块高权重黄按钮改为 Mineral Garden Primary；安装扩展降为 Secondary/Ghost。
- 阅读列表行含 favicon/缩略图（40px，可选）、标题两行、来源与预计阅读时间；无缩略图也需保留对齐，不生成大 Card。
- Reader 宽度 `680–760px`，正文 `16px/28px`，行长上限约 42 汉字；阅读进度用 2px 鼠尾草绿顶部线，不用厚进度条。
- 稍后读状态仅使用：未读、阅读中、已读、归档；用文字/细点表示，避免“大量彩色状态标签”。

### 6.3 复盘：从报表感改为反思感

- 保留日报/周报/月报/年报导航与日历，但左侧日历和右侧摘要不都包成厚 Card：主阅读面为 surface，日历是低强调的 contextual pane。
- 摘要指标以行内数字与简短文字呈现，避免 Dashboard KPI 的大数字卡堆叠。`完成 8 · 写下 1 · 结转 2` 更适合个人复盘。
- 热力日历采用 `accent.subtle → accent.primary` 的 4 级色阶；不要按日报/周报/月报分别分配品牌色。
- 编辑器保持纸张感但无拟物纸纹；段落最大宽度 720px，模块间 24px；引用任务/文章为低调 entity chip。

## 7. Token 重构规范

组件禁止直接引用 hex。现有 `@vital/tokens` 是唯一色彩来源；在 `theme.ts` 和 `css/semantic.css` 中同步替换当前暖黄/棕黑 primitive。

### 必须新增或统一的语义 token

```ts
type SemanticColorTokens = {
  bgApp: string;
  bgSurface: string;
  bgSurfaceMuted: string;
  bgElevated: string;
  bgAccentSubtle: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  borderDefault: string;
  accentPrimary: string;
  accentHover: string;
  accentOnPrimary: string;
  focusRing: string;
  stateSuccess: string;
  stateWarning: string;
  stateError: string;
  stateInfo: string;
};
```

CSS 的兼容迁移可临时保持 `--bg-canvas`、`--fg-muted`、`--accent-primary` 等旧别名，但新组件只使用新命名：`--bg-app`、`--text-primary`、`--text-secondary`、`--bg-elevated`。迁移完成后再删除旧别名；不要在组件里同时写两套颜色逻辑。

同时调整全局 token：`--radius-sm: 6px`、`--radius-md: 8px`、`--radius-lg: 12px`、`--radius-xl: 16px`；`--control-h: 36px`、`--control-h-prominent: 40px`、`--field-h: 40px`。可点击目标在纯触屏环境仍保持 44px hit area（可用外围 padding 补足）。

## 8. 分阶段重构方案

| 阶段 | 范围 | 交付与验收 |
|---|---|---|
| 0. 基线 | 截图当前关键页、列出现有硬编码色/`rounded-2xl`/影子 | 为 light/dark、今日/收集/复盘建立视觉回归基线；标记全宽 Canvas、空置 Detail 和卡片化区域 |
| 1. Token | `packages/tokens/src/theme.ts`、`css/semantic.css`、Web Tailwind 映射 | 已落地 2026-09-06：`pnpm --filter @vital/tokens test` |
| 2. Shell | Rail、SecondaryPane、导航、按钮、输入、Popover | 已落地 2026-09-06：Rail 56px 书脊；Library 224–264；Detail 按需 |
| 3. Todo | `QuickAdd`、`TaskRow`、详情、List/Board/Calendar | 已落地 2026-09-06：`data-region="focus-canvas"`，无空 Detail |
| 4. Inbox | 收集面板、阅读队列、Reader、空态 | 已落地 2026-09-06：`data-region="reading-canvas"` |
| 5. Reports | 日历、摘要、编辑器、实体引用 | 已落地 2026-09-06：`data-region="reflection-canvas"` |
| 6. QA | 多主题、响应式、键盘、动效、截图回归 | 进行中：自动化测试 + 浏览器核对 |

### 代码级优先级

1. 先改 `packages/tokens/src/theme.ts` 与 `packages/tokens/src/css/semantic.css`，再改 `apps/web/src/styles/app.css` 的 Tailwind 映射。
2. 接着统一 `apps/web/src/ui/{button,field,date-field}.tsx`、`shell/{Shell,SecondaryPane,rail-nav}.tsx`；先实现 Canvas 宽度、Library 折叠和按需 Detail，它们决定整体结构与 80% 的观感。
3. 最后逐功能页处理 `features/todos`、`features/inbox`、`features/reports`。不要跨阶段混入数据模型、路由或权限重构；结构调整只改变布局状态与呈现优先级。

## 9. 验收清单

- [ ] Light / Dark 都不使用纯白大底或纯黑大底，且 surface 层级一眼可辨。
- [ ] 鼠尾草绿是唯一品牌强调色；金黄、`amber`、`pulse` 命名已从视觉 token 中移除。
- [ ] 任一页面至多一个主要实心动作；任务、阅读、复盘条目默认不是 Card。
- [ ] 所有目录支持清晰的 L1–L4 缩进、展开、选中和键盘焦点。
- [ ] 今日常规任务行高度 44–48px，详细任务行不超过 68px。
- [ ] 所有文本/状态的对比度达到 WCAG AA；只有色盲不友好的颜色不能作为唯一状态载体。
- [ ] 鼠标 hover、键盘 focus、触屏 hit target 和 reduced-motion 都有等价体验。
- [ ] 桌面、窄桌面与移动端保持同一信息层级，只改变布局，不改变 token 和交互语义。
