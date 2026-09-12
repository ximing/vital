# Vital 移动端设计规范（v2.0 Mobile · Emerald Garden）

> 施工图。所有色值/字号/间距取自 `packages/tokens/src/theme.ts`（RN）与 `packages/tokens/src/css/semantic.css`（SSOT）。禁止发明新色；需要新 token 的地方集中在文末「需新增 token」清单。
> 适配基准：390×844（iPhone 14 类），向下兼容 360px 宽 Android；全部尺寸单位 = RN 无单位 pt。
> 字体：移动端不加载自定义字体。中文标题不用 Sora，用系统字 `-apple-system / PingFang SC`，靠字重（700/600/500）+ 字号梯度做杂志感。数字/日期/计数一律 `fontVariant: ['tabular-nums']`。

---

## 0. 主题与 token 引用约定

实现时一律 `const t = useTheme()` 后引用 `t.*`，下表是本文用语与 token 的对应：

| 本文用语 | theme.ts key | Light 值 |
|---|---|---|
| canvas | `bgCanvas` | `#F3F5F2` |
| surface | `bgSurface` | `#FAFBF9` |
| 白卡 / elevated | `bgElevated` | `#FFFFFF` |
| muted 槽底 | `bgSurfaceMuted` | `#EBEEE9` |
| 品牌绿 | `accentPrimary` | `#1C7A4F` |
| 深绿（pressed） | `accentPrimaryHover` / `accentDeep` | `#155E3D` |
| 浅绿底 | `bgAccentSubtle` | `#DFEDE4` |
| 主文案 | `fgPrimary` | `#1B211D` |
| 次文案 | `fgMuted` / `textSecondary` | `#555E56` |
| 弱文案 | `textTertiary` | `#98A098` |
| 发丝线 | `borderSubtle` | `#E2E6E0` |
| 完成绿 | `statusDone` | `#2F9E63` |
| 今天蓝 | `statusDoing` | `#3D6FD1` |
| 临近琥珀 | `statusDueSoon` | `#B4761E` |
| 逾期红 / 危险 | `statusOverdue` / `danger` | `#CE4A45` |
| 收藏金 | `statusFavorite` | `#D9A62E` |
| 遮罩 | `scrim` | `rgb(27 33 29 / 32%)` |

- 语义色浅底（banner、chip 底、热力格）：用现有 `withAlpha(hex, alphaHex)`（`src/ui/color.ts`）混合，不新增色值。推荐 alpha：`14`（8%）、`1F`（12%）、`2E`（18%）。
- 阴影：只用 `rnShadow(t)`（`src/ui/card.ts`，已是 token 双层阴影的 RN 近似）。浮层/底部 action bar 用 `rnShadow` + 加大 `shadowRadius` 到 16。
- lint 禁 hex/rgba 字面量，新样式必须走 `t.*` 或 `withAlpha(t.*)`。

## 1. 通用语言

### 1.1 页面骨架

```
┌─────────────────────────────┐
│ SafeArea top（状态栏）        │
│ 页头（大标题行，高 52）        │
│ 内容 ScrollView/FlatList      │
│ （底部固定 action bar，可选）  │
│ Tab bar（56 + home inset）   │
└─────────────────────────────┘
```

- 页面容器：`SafeAreaView edges={['top']}`，`backgroundColor: t.bgCanvas`。底部 inset 由 tab navigator 处理，页面不自己补。
- **大标题页头**（改造现有 `TabHeader` / `TodosHome.header` 为同一组件 `PageHeader`）：
  - 高 52，`paddingHorizontal: 16`，垂直居中，flexDirection row，gap 8。
  - 标题：`fontSize 26 / lineHeight 34 / fontWeight '700'`（= `t.type.display`），`color: t.fgPrimary`，`numberOfLines: 1`。
  - 标题旁可挂 baseline 对齐的日期/副信息：`13/18`，`t.textTertiary`，tabular-nums（如「9月12日 · 周六」）。标题与副信息 baseline 对齐，gap 8。
  - 左侧（仅待办）：抽屉入口图标按钮；右侧：图标按钮组（搜索、⋯）。
  - **图标按钮**：40×40，hitSlop 4（保证 44 触控），图标 22px（lucide，`strokeWidth 1.8`），默认色 `t.fgPrimary`；pressed：`opacity 0.5`。统一封装 `IconButton`（现 TodosHome/SearchIconButton 里的散样式收编）。
- 页头与内容之间无分割线、无底色差——都落在 canvas 上，层级靠留白（页头下间距 8）。

### 1.2 卡片规格（`Card`，改造 `cardStyle`）

移动端卡片是「白底浮在浅灰绿 canvas 上」，与 web 的 hairline 面板不同：

| 用途 | 背景 | 圆角 | 描边 | 阴影 | padding |
|---|---|---|---|---|---|
| 内容卡（统计卡/提案卡/设置区块卡/收集条目卡） | `t.bgElevated` | `t.radius.lg` (14) | 无 | `rnShadow(t)` | 16 |
| 报告纸卡（移动端唯一「纸」） | `t.bgElevated` | `t.radius.xl` (20) | 1px `t.borderSubtle` | `rnShadow(t)` | 20 |
| 浮层卡（底部弹出的操作卡） | `t.bgElevated` | `t.radius.xl` (20) | 无 | `rnShadow` + radius 16 | 16 |

- 卡片与卡片间距 12；卡片与分组眉间距 8。
- pressed 态（可点卡片）：`opacity 0.7`（不做 scale，避免动画成本）。

### 1.3 分组眉 eyebrow-rule（改造 `SectionHead`）

分组眉是移动端列表分节的唯一形式，**禁止**「16px 粗体 + 灰字」旧式分组头。

```
⌄ 已过期  2 ────────────────────────── 顺延
```

- 容器：row，垂直居中，gap 8；`marginTop: 24`（首组 8），`marginBottom: 8`，`paddingHorizontal: 4`。
- chevron（可折叠时）：12px，`t.textTertiary`，展开 90° 旋转（Animated rotate，180ms）。
- 标签文字：`fontSize 11 / lineHeight 14 / fontWeight '600'`，`letterSpacing: 1`，英文自动大写由文案层保证（RN textTransform 对中文无效，直接写大写英文或中文原样）；默认色 `t.textTertiary`。
  - 强调变体：`tone="accent"` → `t.accentPrimary`（置顶）；`tone="danger"` → `t.statusOverdue`（已过期）。
- 计数：11/14，`t.textTertiary`，tabular-nums，与标签 gap 6。
- 发丝线：flex 1，高 `StyleSheet.hairlineWidth`，`t.borderSubtle`。
- 右侧可选动作（如「顺延」）：12/16，`t.accentPrimary`，fontWeight 500，hitSlop 8。

### 1.4 列表行通用解剖

**任务行**（改造 `TaskRow`，todo/today/复盘回顾共用）：

```
○ 24px checkbox   标题 16/500（最多 2 行）
                  备注预览 13px 一行 tertiary（可选）
                  ● 9月12日 · 收集箱 · #标签   meta 12px
```

- 行容器：row，alignItems flex-start，gap 12，`paddingVertical: 12`，`paddingHorizontal: 16`；无卡片、无分割线，行与行靠留白分隔；pressed 行底色 `t.bgSurfaceMuted` + `borderRadius: t.radius.lg`。
- checkbox：24×24 圆形，`borderWidth: 1.5`，默认 `borderColor: t.textTertiary`（保证在 canvas 上可见，现状太浅）；逾期未完成 `borderColor: t.statusOverdue`；完成态填充 `t.statusDone` + 白色 ✓ 13px。hitSlop 8。
- 标题：16/22，fontWeight 500，`t.fgPrimary`；完成态 `t.fgMuted` + 删除线。
- 备注预览：13/18，`t.textTertiary`，一行 numberOfLines 1。（依赖 htmlToText 数字字符引用 bug 修复，见侦察 bug 1）
- meta 行：row，gap 8，12/16：
  - 日期：语义色文字（逾期 `statusOverdue` / 今天 `statusDoing` / 临近 `statusDueSoon` / 其他 `textSecondary`），tabular-nums；**逾期只着色日期，不染红整行**。
  - 清单名：`t.textTertiary`；标签：`#name` `t.textTertiary`，最多 3 个，超出 `+N`。
  - 优先级不再用左侧色条（现在的 3px rail 去掉），改为标题前的优先级旗标图标 14px（P0 `statusOverdue`、P1 `statusDueSoon`、P2 `statusDoing`、P3 不显示）。

**导航行**（设置/我的/清单抽屉共用 `NavRow`）：

```
[icon]  标签                    右值(可选)  ›
```

- 高 52，`paddingHorizontal: 16`，gap 12；icon 22px `t.fgMuted`；标签 15/22 `t.fgPrimary` fontWeight 400；右值 13 `t.textTertiary`；chevron 16px `t.textTertiary`。
- 卡片内相邻 NavRow 之间：左缩进 50（icon 22 + gap 12 + 16）的 hairline 分隔线。
- pressed：整行 `backgroundColor: t.bgSurfaceMuted`。

**PickerSheet 选项行**（改造现有）：高 48，15/22 `t.fgPrimary`；destructive 选项 `t.danger`；选中项右侧 ✓ `t.accentPrimary`。

### 1.5 按钮层级（改造 `Button`，补 `size`）

| variant | 背景 | 文字 | 用途 |
|---|---|---|---|
| primary | `t.accentPrimary` | `t.fgOnAccent` | 每屏/每局部至多一个实心主按钮 |
| ghost | `t.bgAccentSubtle` | `t.accentPrimary` 600 | 次级强调（空态动作、换一个） |
| secondary | `t.bgSurfaceMuted` | `t.fgPrimary` 600 | 普通次级 |
| quiet | 透明 | `t.fgMuted` 500 | 行内文字按钮 |
| danger-outline | 透明 + 1px `t.danger` 描边 | `t.danger` | 破坏性，确认前不实心 |

- size：`sm` h32 padding 12 / `md` h36 padding 16（= `t.controlH`）/ `lg` h44 满宽（action bar 用）。
- pressed：primary/danger `backgroundColor: t.accentPrimaryHover`（不再只用 opacity）；其余 `opacity 0.7`。
- disabled：`opacity 0.4`。

**FAB**：56×56 圆，`t.accentPrimary`，plus 图标 26px `t.fgOnAccent`，`rnShadow` + shadowRadius 12；位置 `right: 20`，`bottom: 20`（相对 tab bar 上沿）；pressed `t.accentPrimaryHover`。FAB 页面列表 `contentContainerStyle.paddingBottom = 96`（56 + 20 + 20 余量），修复 FAB 遮挡末行 bug。

**底部固定 action bar**（新增 `ActionBar` 组件，替代被 tab bar 遮挡的按钮行）：

- 结构：`position: absolute` 贴 tab bar 上沿；`backgroundColor: t.bgElevated`；顶部 1px `t.borderSubtle` 发丝线；`rnShadow` 反向（shadowOffset y -2，radius 12，opacity 0.06）。
- padding：`12 16`，底部再加 home indicator inset 时由 tab 布局处理（action bar 在 tab bar 之上，不加 bottom inset）。
- 内部：左侧状态/辅助文字（12/16 `t.textTertiary`，tabular-nums），右侧按钮组 gap 8；主按钮 h36，需要强操作时 h40。
- 内容区 `paddingBottom` = action bar 高度 + 16。

### 1.6 chips 与分段控件

- **筛选 chip**（收集/复盘周期外的轻筛选）：h32 pill，`paddingHorizontal 14`，13/18 fontWeight 500；默认：1px `t.borderSubtle` 描边 + `t.bgElevated` 底 + `t.fgMuted` 字；选中：`t.bgAccentSubtle` 底 + 无描边 + `t.accentPrimary` 字 600。横向滚动时 row gap 8，首尾 padding 16。
- **分段控件**（复盘日/周/月/年、外观浅/深）：槽 `t.bgSurfaceMuted`，radius pill，padding 3；选项 h32 pill radius，13/18 500 `t.fgMuted`；选中项 `t.bgElevated` 底 + `t.fgPrimary` 600 + `rnShadow` xs。等分 flex 1。
- **标签 chip**（任务标签）：h28 pill，`paddingHorizontal 12`，`t.bgAccentSubtle` + `t.accentPrimary` 12/16 600。
- **状态 chip**（线程状态等）：h24 pill，`paddingHorizontal 10`，12/16 500；`withAlpha(语义色,'1F')` 底 + 语义色字。

### 1.7 空态（改造 `EmptyState`）

- 居中，`paddingVertical: 56`。
- 图形：48×48 圆，`t.bgAccentSubtle` 底 + 内部 22px lucide 图标 `t.accentPrimary`（替换现在的「绿圈空环」——不同页面给不同图标：收集 BookOpen、待办 CheckCircle2、复盘 CalendarDays）。
- 文案：14/21 `t.fgMuted`，最多两行；下方可挂 13/18 `t.textTertiary` 辅助行。
- 动作：ghost 按钮（不是 primary——空态不是主流程强制项；首启 onboarding 场景才用 primary）。

### 1.8 骨架屏（新增 `Skeleton` / `SkeletonScreen`，替换整页 spinner）

- 基础块：`backgroundColor: t.bgSurfaceMuted`，`borderRadius: 6`；Animated opacity 0.55→1 往返 1200ms（`useNativeDriver: true`）。
- 列表页骨架 = 页头条（26 高圆角条，宽 40%）+ 6 行假任务行（24 圆 + 两行条：60% / 40%）。
- 卡片页骨架 = 白卡轮廓内 3 条横条。
- 仅首屏加载用骨架；下拉刷新仍用 `RefreshControl tintColor: t.accentPrimary`。

### 1.9 交互态汇总

| 态 | 规格 |
|---|---|
| pressed（行/图标） | `opacity 0.5`（图标）/ 行底 `t.bgSurfaceMuted`（可点行） |
| pressed（按钮） | primary 换 `accentPrimaryHover`；其余 `opacity 0.7` |
| disabled | `opacity 0.4` |
| loading（按钮内） | `ActivityIndicator color=t.fgOnAccent / t.accentPrimary` |
| 长按 | 列表实体行统一长按弹 `PickerSheet` 上下文菜单（无手势库，不做 swipe） |
| 动画 | 只用 opacity/translate；spring tension 68 friction 11（沿用 BottomSheet）；时长 ≤240ms |

### 1.10 暗色主题注意点

- 所有色值自动随 `useTheme()` 切换；设计稿只画浅色。实现自查清单：
  - 暗色卡片 = `bgElevated #232925` 浮在 `bgCanvas #0F1210` 上，层级差足够，**不要**再给卡片加亮描边。
  - `rnShadow` 已有暗色分支（opacity 0.3 / radius 12），勿覆盖。
  - 未读点、选中勾、FAB 在暗色自动变为发光薄荷 `#5FD3A1`，FAB 上图标色用 `t.fgOnAccent`（暗色下是 `#0B1611` 深字），已含在 token。
  - 热力格 `withAlpha(t.accentPrimary, ...)` 在暗色同样成立，无需分支。
  - 状态 chip 的 `withAlpha` 浅底在暗色下对比度已验证可用（token 的暗色语义色更亮）。

---

## 2. 逐屏设计

### a. 待办列表（重点） `app/(tabs)/todos.tsx` + `features/todos/TodosHome.tsx`

**信息架构**：智能清单（今天/明天/本周/收集箱/已完成）+ 用户清单，经左侧抽屉切换；当前清单内按「置顶 / 已过期 / 今天（或清单默认组）」分组。

**自上而下结构**：

1. **PageHeader**：左 `Menu` 图标按钮（开抽屉）→ 大标题（当前清单名，26/700）→ `Search` → `Ellipsis`。
2. **分组列表**（`TaskList grouped`，FlatList）：
   - 置顶组：eyebrow `tone="accent"`「置顶」+ 计数。
   - 已过期组：eyebrow `tone="danger"`「已过期」+ 计数 + 右侧动作「顺延」（accent 12px，触发 `postponeOverdue`）。
   - 今天组：eyebrow 默认「今天」+ mono 日期（如「9月12日」放计数位之后？——不，日期放 eyebrow 右侧动作位，`t.textTertiary` 12px tabular-nums）。
   - 普通清单视图：单组「未完成」+ 底部「已完成 n」折叠组（见下）。
   - 组内任务行按 §1.4 任务行解剖。
3. **FAB**：右下，进入 `NewTaskBar`（输入条从 FAB 位展开为贴 action bar 位的输入行——维持现状的 compose 切换即可，视觉：h48 白底 pill + 1px `borderSubtle` + rnShadow，左侧 plus 图标，placeholder「添加任务」）。

**入口归属**：
- 「查看已完成」→ `⋯` PickerSheet 第一项（跳转 `smart:done`）；普通清单页内同时保留底部「已完成 n」折叠 eyebrow 组（chevron 展开）。
- 「看板 / 周视图」→ `⋯` PickerSheet 第二、三项（代码已写好，把 `showViews={false}` 放开为 true，入口收在 ⋯ 内，不在页头加 icon）。
- `⋯` 菜单完整项：查看已完成 / 看板视图 / 周视图 / 全部顺延（仅存在逾期时出现）/ 清单管理（跳抽屉并高亮管理区）。
- **长按任务行** → PickerSheet 上下文菜单：今天 / 明天 / 选择日期 / 移动清单 / 置顶|取消置顶 / 删除（danger）。

**关键尺寸**：行 paddingVertical 12；组间距 eyebrow marginTop 24；列表 `paddingBottom: 96`（FAB inset，修 bug 4）；checkbox 24。

### b. 任务浮层 TaskSheet（重点） `features/todos/TaskSheet.tsx`（容器 `BottomSheet` 已支持半屏/全屏双档）

**半屏档（64%）信息密度**：一屏内看完「清单、优先级、日期、标题、备注开头、标签」，工具条钉底。

1. **sheet 头行**（h48，`paddingHorizontal: 8`）：
   - 左：清单 chip —— h32 pill，`t.bgSurfaceMuted` 底，13/18 600 `t.fgPrimary`，右侧 chevron-down 14px；点击弹清单 PickerSheet。
   - 右：优先级四档段选 —— `t.bgSurfaceMuted` 槽 radius 10 padding 2，四个 30×30 按钮，旗标图标 16px：P0 紧急 `statusOverdue`、P1 高 `statusDueSoon`、P2 中 `statusDoing`、P3 无 `textTertiary`；选中项 `t.bgElevated` 底 + rnShadow xs，未选中 opacity 0.4。
   - 最右 `Ellipsis` 图标按钮 → PickerSheet：置顶 / 添加子任务 / 放弃 / 删除（danger）/ 打开完整详情（跳 `/todos/task/[id]`）。
2. **内容区**（`paddingHorizontal: 20`）：
   - 日期行：checkbox 24 + 日期文字 14/20 600（逾期红/今天蓝/普通 `fgMuted`），点击弹日期 PickerSheet。
   - 标题：22/30 700 `t.fgPrimary`，TextInput 多行，无框。
   - 备注：14/21，有内容显示 `fgMuted` 前 3 行；无内容 placeholder「添加备注」`textTertiary`；点击进全屏档编辑。
   - 标签 chips 行（有标签时）：标签 chip + 虚线描边「+ 标签」chip。
3. **底部工具条**（钉底，h56 + 顶部发丝线 `borderSubtle`）：图标按钮组：标签（Tag）/ 子任务（ListTodo）/ 提醒（Bell）/ 排期（CalendarClock）。**删除 Paperclip 假功能**（修 bug 2）。
4. 手势沿用 BottomSheet 现状：半屏上滑→全屏，下滑→关闭。

**全屏档**：从状态栏下沿铺满；头行左侧变为 `‹`（收回半屏）+ 清单 chip；内容区可滚动，增显示子任务区（eyebrow-rule + 子任务行 + 添加行）与完整备注编辑；工具条不变钉底。

- sheet 背景 `t.bgElevated`，半屏圆角 `radius.xl` 20 顶角，scrim `t.scrim`。

### c. 任务详情页 `/todos/task/[id]` `features/todos/TaskDetail.tsx`

**结构**（Screen scroll，内容 `paddingHorizontal: 16`）：

1. **页头**（h52）：左 `‹` 返回；右侧：置顶图标（Pin，置顶时 `statusFavorite` 实心，否则 `fgPrimary` 线框）、`Ellipsis`（放弃 / 删除 / 移动清单）。
2. **完成 + 大标题区**：row：checkbox 28（详情页加大）+ 标题 TextInput 22/30 700 多行。完成态标题 `fgMuted` 删除线。
3. **快捷排期 chips 行**：「今天」「明天」「下周」「清除」筛选 chip 样式（h32），当前命中的 chip 为选中态；横排 gap 8，置于属性卡之上。
4. **属性卡**（内容卡，padding 0，NavRow 变体 `PropRow`：高 48，icon 20px `fgMuted` + 标签 13 `textTertiary` 宽 64 + 值 14 `fgPrimary` 右对齐 + chevron）：
   - 日期（Calendar）值着色同 meta 规则；提醒（Bell）；重复（Repeat）；优先级（Flag）；清单（Inbox）；标签（Tag，值为 chips 预览最多 2 个）；预计时长（Timer，PickerSheet 选 15/30/60/120/自定义）。
   - 行间 hairline 左缩进 48。
5. **子任务区**：eyebrow-rule「子任务」+ 计数；子任务行 = 任务行解剖缩小版（checkbox 20，标题 14/500）；底部「+ 添加子任务」quiet 行。
6. **备注区**：eyebrow-rule「备注」；TextInput 14/21.5（lineHeight 21）多行，minHeight 120，placeholder「添加备注」。
7. **底部 ActionBar**：左侧保存状态（12 `textTertiary` tabular-nums：「已保存 11:02」/「未保存更改」/「保存中…」），右侧：`保存` primary h36（仅 dirty 时可用）+ `完成|重做` ghost h36。

### d. 复盘（重点） `features/reports/ReportList.tsx` + `ReportEditor.tsx`

**自上而下**（单 ScrollView，paddingHorizontal 16，书写面优先，统计区沉后）：

1. **PageHeader**：「复盘」+ 右 Search。
2. **kicker 行**：eyebrow `tone="accent"`「把完成的事留下痕迹」+ 发丝线；右侧保存状态 12 `textTertiary` tabular-nums（「已自动保存 11:02」/「保存中…」/「有更改未保存」）。（对齐 web §6.3）
3. **周期分段控件**（§1.6 分段控件）：日 / 周 / 月 / 年。
4. **meta 行**：mono 周期范围 12 `textSecondary` tabular-nums（日报 `2026-09-12 · 周六`；周报 `09-07 – 09-13 · W37`）。
5. **review 统计卡**（内容卡）：三等分 row；每格：6px 语义色点（完成 `statusDone` / 结转 `statusDoing` / 收集 `statusDueSoon`）+ 数字 20/28 700 tabular-nums + 标签 12 `fgMuted`。下方可挂一行 streak 提示 12 `fgMuted`（「连续完成 4 天」）。
6. **回顾分节**（去卡片化，直接落在 canvas）：完成（默认展开）/ 结转 / 收集，均为 eyebrow-rule + chevron 折叠 + 计数；行 = 任务行解剖（无 checkbox，完成行前置 ✓ `statusDone` 14px；收集行前置来源色点 6px）。
7. **报告纸卡**（§1.2 纸卡；移动端不加顶部渐变发丝线——RN 渐变成本高，用 3px `accentPrimary` 圆角细条代替，padding 顶 20）：
   - 标题：TextInput 20/28 700（可编辑，修「标题不可编辑」差距）。
   - 正文：TextInput 14/24.5（lineHeight 1.75）多行，minHeight 180；渲染态（非聚焦）用修复后的 `ReportMarkdown`（激活死代码前先修 htmlToText bug）。
   - 卡内底部：quiet 按钮行「插入任务」「插入稍后读」（13px accent + 图标）。
8. **底部 ActionBar**（修 bug 3 的核心）：左保存状态同 kicker（kicker 处可省略，统一放这）；右：`填充` quiet、「生成」ghost（LLM 一键生成，无 LLM 配置时 disabled + 点击 toast 引导）、`保存` primary h36。
9. **统计与热力区**（滚到 editor 之后）：
   - eyebrow-rule「往期」。
   - 月历卡（内容卡 padding 12）：7 列网格，每格 40×44：日号 12 tabular-nums + 底部 4px wrote 点（`accentPrimary`）。
     - **绝对刻度**（修 bug 6）：有完成日底色 = `withAlpha(t.accentPrimary, round((0.18 + 0.62 * min(n,5)/5) * 255))` 转 hex alpha（n=1→约 30% 用 `4D`，n=3→约 55% 用 `8D`，n=5+→80% 用 `CC`；中间值按公式取整），radius 10。
     - 选中日：实心 `t.accentPrimary` + 白字；今天：热力底 + 2px `t.accentPrimary` 描边环（今天且选中时只实心）。
     - 月/年粒度保持相对归一化（现状逻辑保留）。
   - eyebrow-rule「最近完成」+ 内容卡列表行（标题 14 + 右侧 mono 时间 12 `textTertiary`，hairline 分隔）。
10. 复盘 tab 补 `RefreshControl`（修「无下拉刷新」）。

### e. 收集 `features/inbox/InboxList.tsx` + `InboxDetail.tsx`

**列表**：

1. **PageHeader**：「收集」+ 右 Search。**新建入口改为 FAB**（方案见下），顶栏不再放「新建」按钮。
2. **筛选 chips 行**（横滚）：全部 / 未读（带 mono 计数）/ 收藏 / 归档。选中态见 §1.6。
3. **日期分组眉**：今天 / 昨天 / 本周 / 更早 + mono 计数（eyebrow-rule，无 chevron）。
4. **条目卡**（内容卡，padding 14 16，卡片间距 10）：
   - 头行：来源 tile 24×24 radius 6（`src.*` 五色底 + 白色首字母 12px 700；web `#3D6FD1`、微信 `#229E4E`、扩展 `#6A5CD0`、手动 `#2C9C8C`、移动端 `#B4761E`——**src.\* 需进 theme.ts**，见新增 token 清单）+ 标题 15/22 600（未读 `fgPrimary`，已读 `fgMuted`）+ 未读点 8px `accentPrimary` 圆（标题行右端）。
   - 摘要：13/19 `fgMuted`，numberOfLines 2。
   - meta 行：12/16 `textTertiary`：来源名 · 相对时间（tabular-nums）· 收藏星（实心 14px `statusFavorite`，未收藏不显示）· 已转任务 chip（h20 pill `bgAccentSubtle` accent 11px）。
5. **长按条目卡** → PickerSheet：标为已读|未读 / 转任务 / 收藏|取消收藏 / 归档 / 删除（danger）。
6. **FAB 新建方案**：与待办一致的 56 FAB，点击弹 `InboxCompose` 的 BottomSheet（半屏）。理由：移动端主创建入口统一 FAB 心智（待办/收集一致），顶栏只留搜索，减少页头拥挤；空态页内仍保留 ghost「新建一条」按钮双入口。

**详情阅读器** `InboxDetail.tsx`：

1. 页头：`‹` + 右侧 `Aa`（字号三档循环 sm 14/24.5 → md 16/28 → lg 18/31.5，当前档用 accent 高亮）、星（收藏）、归档（Archive）、`Ellipsis`（转任务 / 复制链接 / 删除）。
2. 标题块：22/32 700；meta 行：来源 tile 20 + 来源名 13 `fgMuted` + 时间 13 `textTertiary`；原文链接行：13 accent 可点 + 复制图标按钮。
3. 正文：默认 md 档 16/28（1.75），段距 16；blockquote 左 2px `accentPrimary` 边线；正文最大宽不限（移动端全宽，paddingHorizontal 20）。
4. 底部 ActionBar：`转任务` primary h36 + 「标为已读」quiet（未读时）。

### f. 今天 `features/today/TodayWorkspace.tsx`

**不改信息架构**，只按 §1 视觉升级：

1. **PageHeader**：「今天」26/700 + baseline 副信息「9月12日 · 周六」13 `textTertiary`；右 Search。
2. **PulseStrip**：筛选 chip 横滚（icon 14 + 13px 文案；`✓ 今日复盘已写` 用 `statusDone` icon；计数 tabular-nums）。
3. **NowCard**（内容卡，左 4px `accentPrimary` 圆角竖条——padding 左 20 实现）：eyebrow「当下」accent；时间 34/40 700 tabular-nums `fgPrimary`；meta「接下来约 659 分钟」13 `fgMuted`；eyebrow「建议开始」+ 右侧 ghost sm「换一个」；**双推荐并排**（修「只 1 条」）：row gap 10，两张 mini 卡 flex 1（`bgSurfaceMuted` 底 radius 10 padding 12：标题 14/20 600 两行 + meta 12 `textTertiary` 一行：清单 · 估时 · 日期色字）。
4. **逾期 banner**（改造 `Banner` tone="error" 的误用，修 bug 10）：`withAlpha(t.statusOverdue,'14')` 底 radius 12 padding 12 14，icon AlertCircle 16 `statusOverdue` + 文案 13 `fgPrimary`（「2 项已过期」加粗数量）+ 右侧 quiet「全部顺延」accent。error 用 `withAlpha(t.danger,'14')`，info 用 `bgAccentSubtle`。
5. **习惯车道**：eyebrow-rule「习惯」+ 横滚 habit 卡（内容卡 120×96：32px 圆形打卡钮（完成填 `statusDone` + 白勾）+ 名称 13/18 500 一行 + 连续 n 天 11 `textTertiary` tabular-nums）。无活跃习惯显示 `HabitEmptyCard`（空态变体，ghost「创建习惯」→ 习惯管理页）。
6. **Agent 提案卡**（内容卡）：eyebrow「AGENT 提案」accent + 计数；提案行：icon 16 `fgMuted` + 文案 14/21 + 行尾 quiet「采纳」accent / 「忽略」`textTertiary`；多提案 hairline 分隔。
7. **正在推进**（线程）与**任务列表**：eyebrow-rule 分节；线程行：标题 15/600 + 状态 chip（h24）+ 摘要 13 `fgMuted` 两行；任务行复用 §1.4。
8. 列表 `paddingBottom: 24`（无 FAB）。

### g. 我的 / 设置 `features/me/MeHome.tsx` + `app/settings.tsx`

**结构**：PageHeader「我的」；以下为内容卡分节，节间 20，每节配 eyebrow-rule（账户 / 外观 / 通知 / 偏好 / LLM / AI）。

1. **账户卡**：row：头像 56 圆 +（名字 17/24 600 + 邮箱 13 `fgMuted`）；第二行按钮：ghost sm「更换头像」+ quiet sm「退出登录」（`danger` 文字色）；「怎么称呼你」输入行（h44，`bgSurfaceMuted` 底 radius 10 padding 12，无描边——移动端输入一律此样式，替代 web 的白底描边）+ 右下 primary sm「保存资料」（仅 dirty 可用）。
2. **外观卡**：说明 13 `fgMuted` + 分段控件（跟随系统 / 浅 / 深）。
3. **通知卡**：switch 行（NavRow 变体，右侧 `Switch trackColor={{true: t.accentPrimary}}`）：有提醒时间时推送 / 复盘提醒 / MeoW 接入状态行（右值「已接通」`statusDone` 或「去配置」accent）。
4. **偏好卡**：NavRow：每周起始日（右值「周一」）/ 默认清单 / 语言。
5. **LLM 卡**：NavRow：Provider 配置（右值已配置 provider 名或「未配置」`textTertiary`）/ API Tokens。
6. **AI 卡**（新入口区，NavRow + icon）：习惯（Flame icon）/ 线程（MessagesSquare）/ Agent 活动（Activity，右值可挂「今日 n 次」mono）/ 记忆（Brain）。

### h. 新页面简要规格（全部复用 §1 通用件，从简）

1. **习惯管理** `app/habits.tsx`：PageHeader「习惯」+ FAB 新建（弹 BottomSheet 表单：名称输入行 + 频率 chips 每天/工作日/每周 n 天 + 保存 primary 满宽）。列表行（内容卡内 NavRow 变体）：名称 15/600 + meta「每天 · 连续 4 天」12 `textTertiary` + 右侧暂停 Switch。长按 → PickerSheet：编辑 / 暂停|恢复 / 删除（danger）。
2. **线程列表** `app/threads.tsx`：PageHeader「线程」+ FAB。条目 = 内容卡：标题 15/600 + 状态 chip（进行中 `statusDoing` / 平稳 `textSecondary` / 停滞 `statusDueSoon` / 完成 `statusDone`）+ 最近一条摘要 13 `fgMuted` 两行 + meta「n 件事 · 3 天前」12 `textTertiary`。
3. **线程详情** `app/threads/[id].tsx`：页头 `‹` + 标题 + 状态 chip + `Ellipsis`（重命名 / 归档）；消息列表（用户右对齐 accent 浅底气泡 `bgAccentSubtle` radius 14 padding 10 12；agent 左对齐白卡气泡）；底部输入行（h44 muted 输入 + 发送图标按钮 accent，键盘上方）。
4. **Agent 活动** `app/activity.tsx`：PageHeader「Agent 活动」；按日期 eyebrow 分组；行：状态 icon 20（成功 `statusDone` / 失败 `danger` / 运行中 `statusDoing`）+ 标题 14/500（capability 名）+ 摘要 13 `fgMuted` 一行 + 右值 mono 12 `textTertiary`（耗时 + token 成本 `1.2k tok`）。顶部可挂用量概览小卡（今日调用 n 次 · 成本，mono 数字）。
5. **记忆列表** `app/memory.tsx`：PageHeader「记忆」+ 筛选 chips（全部 / 偏好 / 事实 / 决策）；行：scope chip（h20）+ 内容 14/21 两行 + meta「采纳 3 次 · 2 天前」12 `textTertiary`；长按 → PickerSheet：编辑 / 删除。

---

## 3. 需新增 token 清单（改 `packages/tokens`，需 `pnpm --filter @vital/tokens build`，注意测试锁值）

1. **`src.*` 来源五色进 `theme.ts`**（semantic.css 已有）：`srcExtension/srcWechat/srcWeb/srcMobile/srcManual`（light：#6A5CD0/#229E4E/#3D6FD1/#B4761E/#2C9C8C；dark：#9D8EF0/#5CCF82/#7FA8F0/#E0A94E/#5CC9B8）。收集条目卡来源 tile 必需。
2. **字级补 `type.section`**（16/24，semantic.css 有 `--text-section`，theme.ts 缺）：任务行标题 16、收集标题 15 附近的层级锚点。（任务行标题 16/22 直接写字面量亦可，但建议入 token。）
3. **字级补 `type.eyebrow`**（11/14）：分组眉专用，避免到处写 11 字面量。
4. 不需要新增颜色：浅底一律 `withAlpha`；暗色映射已齐。

## 4. 顺带修复清单（设计落地时一并处理）

- bug 1 htmlToText 数字字符引用（备注/摘要显示 `&#x20;`）。
- bug 2 删 TaskSheet Paperclip。
- bug 3 复盘底部按钮 → ActionBar；今天 paddingBottom 加大。
- bug 4 待办列表 paddingBottom 96。
- bug 5 删死路由 `app/todos/[listId].tsx`；激活或删除 ReportMarkdown。
- bug 6 热力绝对刻度。
- bug 7 splash 色改 `bgCanvas #F3F5F2`。
- bug 8 NowCard 双推荐；全量 Pressable 补 pressed 态。
- bug 9 搜索防抖 300ms。
- bug 10 Banner error 色调修正。

## 5. 实现批次建议

- **批次 1（通用件 + 待办主线）**：`PageHeader/IconButton/ActionBar`、SectionHead eyebrow 化、TaskRow 解剖重做、Button size/variant 补齐、FAB inset、TodosHome ⋯ 菜单（含看板/周视图放开）、长按 PickerSheet。HTML 参照：todos.html。
- **批次 2（TaskSheet + TaskDetail）**：sheet 头行/优先级段选/工具条去 Paperclip/标签 chips；详情页属性卡 + 快捷排期 + ActionBar + 保存状态。参照：task-sheet.html、task-detail.html。
- **批次 3（复盘）**：分段控件、统计卡、折叠分节、纸卡 + ActionBar、绝对刻度热力、下拉刷新。参照：reports.html。
- **批次 4（收集 + 阅读器）**：筛选 chips、日期分组、条目卡（src.* token 前置）、长按菜单、FAB、字号三档。参照：inbox.html。
- **批次 5（今天 + 我的）**：NowCard 双推荐、banner 色调、习惯车道、提案卡样式；我的分节卡 + NavRow + AI 入口。参照：today.html、me.html。
- **批次 6（新页面）**：习惯/线程/活动/记忆四页（全复用件）。
- **批次 7（打磨）**：骨架屏、空态图标化、搜索防抖、splash 色、死代码清理、暗色走查。
