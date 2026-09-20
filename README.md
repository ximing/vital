# Vital

**AI First 的个人操作系统**：收集（Inbox）→ 执行（Todos）→ 复盘（Reports）。

> [English documentation](README_EN.md)

Vital 是一个中文优先（`zh-CN`）、单用户、自托管的个人效率系统。待办、稍后读、习惯、线程与复盘住在同一个安静的工作区里；**对内有常驻 Agent 替你整理、拆解、起草和记住偏好，对外提供 skill，让 Claude、Codex 等其他 Agent 直接操作同一份数据。**

不追赶协作，不制造焦虑。一个账户就是全部。

| 浅色 | 深色 |
| --- | --- |
| ![浅色今天](docs/screenshots/today.png) | ![深色今天](docs/screenshots/today-dark.png) |

## 产品理念

Vital 是 **AI First**，同时追求 **Calm Productivity（安静而有行动力）**。打开后先看到「接下来做什么」，而不是系统本身；Agent 在后台工作，提议要你点头才落地。

- **一个闭环，而不是一堆工具。** 链接先丢进收集箱，读完后一键转为任务；任务完成后自动汇入当天的复盘；复盘里沉淀的想法再变成明天的行动。Agent 负责发现线程、拆小推迟的任务、起草方案、生成日报，并把你的纠正写成长期记忆。
- **内容先于容器。** 待办、阅读、复盘都是可直接操作的信息行，不是卡片堆；结构靠排版、发丝线和疏密节奏表达。
- **状态有意义，但不制造焦虑。** 逾期只着色日期，绝不把整条任务染红；没有红点、没有 KPI 大数字。
- **单用户，数据归自己。** Postgres 里的每一行都是你自己的数据，随时可以迁走。LLM 密钥按需配置，用多少、花多少都在用量页可见。

视觉主题为 **Emerald Garden（翡翠园）**：暖白纸面、翡翠绿、深墨，以及暗色下的发光薄荷。设计规范见 [docs/vital-calm-productivity-design-system.md](docs/vital-calm-productivity-design-system.md)。

## Agent · AI First 的两条路径

Vital 把 Agent 当成产品的一部分，而不是外挂聊天窗。

1. **对内**：worker 里的后台 Agent 观察你的任务、习惯、反馈，按调度策略自己跑，产出可采纳的提议。
2. **对外**：仓库里的 [skills/vital](skills/vital/SKILL.md) 让其他 Agent 用个人访问令牌调用同一套 HTTP API。

![对内 Vital Agent 与对外 skill 汇入同一份数据](docs/diagrams/ai-first-paths.zh.svg#gh-light-mode-only)
![对内 Vital Agent 与对外 skill 汇入同一份数据](docs/diagrams/ai-first-paths.zh-dark.svg#gh-dark-mode-only)

### 对内：Agent 怎么工作

配置好模型（设置 → 模型，OpenAI Chat Completions 兼容）之后，worker 大约每 30 秒扫一次调度表。状态不在进程内存里，全部落在 PostgreSQL：防抖、冷却、租约、重试、每日预算，进程重启也能接着跑。

按用户隔离：模型只读当前用户的数据；同一用户的同类后台任务不会并行。跨用户共享可配置的全局并发。每用户每天默认 100 次后台模型请求（按时区切日），超额推迟到次日。

| 能力 | 做什么 | 默认触发 |
| --- | --- | --- |
| 看板状态 `agent.headline` | 给线程写一句话现状和下一步 | 线程内任务变化后防抖；每日巡检补陈旧线程 |
| 线程聚类 `agent.cluster` | 从未归属的任务里发现并命名新线程 | 任务变化后防抖；至少 4 项未完成且不属于习惯 |
| 任务拆解 `agent.decompose` | 把反复推迟的任务拆成子任务 | 推迟次数触发，提议需你接受 |
| 方案起草 `agent.draft` | 为勾了「可交给 Agent」的任务起草执行方案 | 任务详情里手动触发 |
| 日报生成 `agent.report` | 根据当天完成、结转、收集生成日报 | 复盘页「一键生成」 |
| 每日反思 `agent.reflect` | 扫描全部线程并更新状态 | 每日一次 |
| 记忆蒸馏 `agent.distill` | 从你的纠正、改名、忽略里学习偏好 | 3 条新反馈或 1 条修改/拒绝后防抖 |
| 主动通知 `agent.notify` | 把洞察写成一句人话推送 | 定时扫描 |
| Critic 复核 `agent.critic` | 第二遍校验（默认关，会翻倍消耗） | 按路由配置 |

提议不会偷偷改你的数据。你可以在今天看板、线程页和 **系统行为** 里采纳、忽略或纠正；手写的记忆优先级最高，蒸馏不会覆盖或删除它们。

![线程工作区](docs/screenshots/thread.png)

![Agent 记忆](docs/screenshots/memory.png)

**系统行为** 能看到 Agent 在等什么、跑过什么、为什么跳过（例如尚未配置模型、今日额度用完）。调度可「立即执行」或取消已积累的观察，不会关掉该能力。

![系统行为](docs/screenshots/activity.png)

每个功能可以走不同的模型。任务解析、看板状态、聚类、拆解、起草、日报、记忆、通知、Critic 都可单独指定，不指定则跟随默认。

![模型路由](docs/screenshots/settings-llm.png)

调度、租约、预算与重启保证的细节见 [docs/agent-scheduling.md](docs/agent-scheduling.md)。

### 对外：Skill 让其他 Agent 接入

仓库自带可安装的 skill：[skills/vital/SKILL.md](skills/vital/SKILL.md)。Claude、Codex、Cursor 或其他能跑 skill 的 Agent 都可以用它操作你的 Vital，而不必再开一个聊天产品。

1. 在 **设置 → 令牌** 签发 `vt_` 前缀的个人访问令牌（明文只显示一次，可随时撤销）。
2. 把 skill 装到对应 Agent，或设置 `VITAL_TOKEN` / `VITAL_API_URL`。
3. API 目录由服务端路由自动生成（`pnpm gen:vital-skill` → [skills/vital/references/api.md](skills/vital/references/api.md)），不要靠记忆编字段。

![访问令牌](docs/screenshots/settings-tokens.png)

Skill 里写好的典型工作流：

- **今天**：`GET /api/v1/today`（线程、任务、脉冲、此刻推荐）。
- **今天的任务**：`GET /api/v1/tasks?listId=smart:today`；自然语言建任务走 `POST /api/v1/tasks/from-text`（需要已配置模型）。
- **线程**：`GET /api/v1/outcomes?status=open`；详情 `GET /api/v1/outcomes/:id/detail`。
- **抓一篇稍后读**：`POST /api/v1/inbox` 可直接带 `markdown` / `extractedHtml`（服务端存 TipTap）；URL 则 `extract` 再入库。读正文用 `GET /api/v1/inbox/:id/markdown`。
- **习惯**：`GET /api/v1/habits`，打卡 `POST /api/v1/habits/:id/tick`。
- **日子**：`GET /api/v1/days`。
- **搜索**：`POST /api/v1/search`，可限定任务 / 稍后读 / 报告。
- **写日报 / 周报**：`GET /api/v1/reports/current?type=daily`，带当前 `revision` 再 `PATCH`。

对内 Agent 和对外 skill 操作的是同一份数据：你在网页里改的，Claude 看得到；Claude 建的任务，今天看板上立刻出现。

## 今天 · 从「当下的一件事」开始

此刻卡片从今天的任务里挑出候选（不是排好的序列，「换一个」只在本地轮换）。下面是正在推进的线程、习惯打卡，以及今天的任务行。顶部脉冲条告诉你收集箱还剩几条、复盘有没有写。

用一句话添加任务时，若已配置模型，会自动识别日期、优先级和摘要。

## 待办 · 信息行，不是卡片

集合、标签、优先级、估时、截止日期、提醒与重复规则。子任务挂在父任务下面；详情开在右侧。习惯实例不会混进普通清单。

- **列表 / 看板 / 周视图** 三种看法。看板按状态或优先级分列；周视图按发生时间摊在日历上。
- 智能列表：今天、最近、收集箱、无日期、已完成。
- 重复：每天、每周、每月、每年、工作日、周末、节假日、法定工作日。
- 提醒：准时、提前 5 / 15 / 30 分钟 / 1 小时 / 1 天，或自定义时刻。
- 置顶、顺延、拖拽排序、右键菜单；`N` 新建，`E` 完成。
- 勾选「可交给 Agent」后，可以让 Agent 起草执行方案，审阅后写进备注或生成子任务。

![待办列表与详情](docs/screenshots/todos.png)

![看板](docs/screenshots/todos-board.png)

![周视图](docs/screenshots/todos-week.png)

深色下的同一套待办：

![深色待办](docs/screenshots/todos-dark.png)

## 稍后读 · 先收进来，再慢慢读

粘贴链接自动抽取正文；也可以写下没有 URL 的备忘。列表 + 双栏阅读器：字号、归档、收藏、复制原文、转为任务、挂到线程、加入报告。

来源可以是网页、浏览器扩展、微信、手机或手动。筛选：全部 / 未读 / 收藏 / 归档，以及标签。

![收集箱](docs/screenshots/inbox.png)

![阅读器](docs/screenshots/inbox-reader.png)

![深色阅读器](docs/screenshots/inbox-reader-dark.png)

Chrome 扩展（MV3 / WXT）可以把当前页、选区或图片存进稍后读或待办，登录走 `/auth/extension`。

## 习惯 · 每天自动生成小任务

习惯不是打卡贴纸，而是会在时间窗内自动生成今天的任务。每日一次或计数（例如喝水 8 次/天）。完成计数习惯的一次，会生成下一次，直到达到目标。

习惯可以挂到线程上（锻炼、喝水 → 身体健康；阅读 → 某个学习线程），进度会反映在今天的线程卡片里。停用后不再生成，历史保留。

![每日习惯](docs/screenshots/habits.png)

## 线程 · 正在推进的目标

线程是跨列表的目标，和集合正交。今天看板上每个线程有状态、下一步、未完成任务数和挂上的资料。关闭后从今天隐藏，任务和材料仍在，可随时重开。Agent 发现的线程在撤销窗口内可以一键解散。

![线程列表](docs/screenshots/threads.png)

## 复盘 · 把完成的事留下痕迹

日 / 周 / 月 / 年报共用一个 Markdown 编辑器（标题、列表、引用、代码、表格、图片与附件）。进行中的任务和稍后读可自动填进报告，也可用 `/` 插入任务或稍后读芯片。往期用日历热度图回顾：格子深浅是完成多少，小点是写下的日子。

配置模型后，日报支持「一键生成」。

![复盘](docs/screenshots/reports.png)

## 搜索与命令面板

`⌘K`（Windows / Linux 为 `Ctrl+K`）呼出命令面板：跳转到集合、任务、线程或稍后读。完整搜索页由 Meilisearch（关键词）+ Qdrant 向量召回 + 重排序驱动；未配置检索组件时对应能力自动降级。

![命令面板](docs/screenshots/search.png)

## 明暗主题

浅色、深色，或跟随系统。Web、桌面、移动端共用同一套 Emerald Garden token（`packages/tokens`）。侧栏一键切换，设置 → 外观也可以选。

| 浅色阅读 | 深色阅读 |
| --- | --- |
| ![浅色阅读器](docs/screenshots/inbox-reader.png) | ![深色阅读器](docs/screenshots/inbox-reader-dark.png) |

![外观](docs/screenshots/settings-appearance.png)

## Web · 桌面 · 移动

三端共用同步协议和同一份后端。桌面是套了壳的 Web；移动端是为手机重排过的原生界面。

| 端 | 技术 | 鉴权 |
| --- | --- | --- |
| **Web** | Vite / React，`localhost:5180` | Cookie（刷新令牌 httpOnly） |
| **桌面** | Tauri 2，内嵌同一套 Web UI | Bearer，存在本地 store |
| **移动** | Expo / React Native（Android） | Bearer；启动时可检查 GitHub Release 自更新 APK |
| **扩展** | Chrome MV3 / WXT | Bearer，用于一键收集 |

![移动端今天](docs/screenshots/mobile-today.png)

![移动端收集](docs/screenshots/mobile-inbox.png)

Android 发布：打 `vMAJOR.MINOR.PATCH` tag，`.github/workflows/android-release.yml` 会把 `app-release.apk` 挂到该 Release。应用启动时读 `GET /api/v1/app/android`，有新 `versionCode` 时用系统下载器后台拉取，下完后在「我的」里安装。

## 更多能力

- **自然语言建任务**：输入「周五前把设计评审意见回掉」，模型填写日期、优先级和摘要。
- **标签与集合图标**：任务 / 稍后读共用标签；集合可设 emoji 或上传图标，支持嵌套。
- **通知**：本机系统通知 + 可选 [MeoW](https://meow.cc) 渠道；全天任务有默认推送时刻；免打扰时段；Agent 洞察可单独开关。
- **用量与成本**：所有模型请求按天、按功能记账（连接测试、任务解析、后台能力）。未知用量不按零计算。见 **用量** 页。

![Token 用量](docs/screenshots/usage.png)
- **同步**：Web / 桌面 / 移动 / 扩展走统一 change-set；收集箱正文在 `inbox_item_bodies`，列表同步不含正文，避免把阅读器缓存冲掉。
- **检索（可选）**：Meilisearch + Qdrant + DashScope embedding / rerank；未配置时搜索与部分 Agent 召回自动关闭。
- **开放 API**：除 skill 外，任何带 `vt_` 令牌的脚本都可以调 `/api/v1`。近 30 天调用记录可在令牌页查看。
- **引导**：首次使用三步清单（收一页、建一条今天的任务、打开周报），可随时跳过。

![通知](docs/screenshots/settings-notifications.png)

## 技术架构

pnpm workspace + Turbo，Node ≥ 22，包名 `@vital/*`。

```
apps/web          Vite / React（cookie auth）
apps/desktop      Tauri 2（bearer；内嵌 web UI）
apps/mobile       Expo（bearer）
apps/extension    Chrome MV3 / WXT（bearer）
apps/server       Fastify 5 + Drizzle + PostgreSQL
packages/tokens   设计 tokens（Pulse / Sora）
packages/dto      Zod DTO 与报告模板（前后端共享）
packages/api-client  生成的 API client
packages/markdown 报告编辑器的 Markdown 渲染
packages/*        共享的 eslint / tsconfig 预设
```

| 服务                        | 端口     |
| --------------------------- | -------- |
| API（`apps/server`）        | **3010** |
| Web / Vite / Tauri `devUrl` | **5180** |

表之间 **没有 PostgreSQL 外键**。`user_id` / `*_id` 是普通 `char(36)`，归属、存在性和级联清理都在服务层、同一事务里完成。约定见 [AGENTS.md](AGENTS.md)。

## 本地开发

```bash
pnpm install

# 1. 准备数据库：任意可达的 PostgreSQL 16（需要 pg_trgm 扩展）
# 2. 配置环境变量
cp apps/server/.env.example apps/server/.env   # 替换所有 change-me，.env 不入库

# 3. 一键启动：迁移 + API :3010 + worker + Web :5180
./dev.sh
```

首次使用可在 Web 注册后执行 seed 造三条示例收集（仅开发环境）：

```bash
NODE_ENV=development pnpm --filter @vital/server seed you@example.com
```

质量检查：

```bash
pnpm lint
pnpm typecheck
pnpm test          # 服务端测试需要 compose 里的 vital_test 库（:5433）
```

运行服务端测试前：`docker compose up -d postgres`（根目录 compose 提供 5433 上的 `vital_test`），并在 `apps/server/.env.test` 里配置测试库连接（参考 `docs/project-standards.md`）。检索组件（Qdrant / Meilisearch / DashScope embedding）全部可选，未配置时对应功能自动降级关闭。

改了 `apps/server/src/db/schema/**` 之后，**请同时重启 worker**（`pnpm --filter @vital/server worker`）。API 的 `tsx watch` 会重载，worker 进程不会。

## 部署

生产环境使用 GHCR 镜像 + Docker Compose，提供两种拓扑：

**自带 Postgres（单机）** —— [docker-compose.prod.yml](docker-compose.prod.yml)：`migrate → server → worker → web`，web 暴露 HTTP 端口，前置任意反向代理即可上 HTTPS。

**外部 Postgres（推荐）** —— [docker-compose.prod.external.yml](docker-compose.prod.external.yml)：数据库与备份托管在专门的 db 主机，compose 只跑 server / worker；宿主 nginx（见 [deploy/nginx.conf](deploy/nginx.conf)）反代到 `127.0.0.1:3010`。

```bash
cp .env.production.example .env    # 填入真实密钥与 PG_HOST；.env 不入库
docker compose -f docker-compose.prod.external.yml pull
docker compose -f docker-compose.prod.external.yml run --rm migrate
docker compose -f docker-compose.prod.external.yml up -d
```

健康检查：`GET /api/health`（进程存活）与 `GET /api/v1/health/ready`（`SELECT 1`）。

## 贡献

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

- **工程规范**：[docs/project-standards.md](docs/project-standards.md)（测试数据库、私有附件签名 URL、视觉实现约束等，改动相关领域前必读）。
- **设计规范**：[docs/vital-calm-productivity-design-system.md](docs/vital-calm-productivity-design-system.md)（色彩 / 字级 / 间距 / 组件的唯一事实来源是 `packages/tokens`，token 需 `theme.ts` 与 `css/semantic.css` 双改）。
- **数据库迁移**：schema 变更改 `apps/server/src/db/schema`，经 `pnpm --filter @vital/server migrate:generate` 生成迁移，`pnpm --filter @vital/server migrate` 应用。
- **API 文档**：路由或 DTO 变更后执行 `pnpm gen:vital-skill` 重新生成 [skills/vital/references/api.md](skills/vital/references/api.md)。
- **截图**：`docs/screenshots/` 来自本地 dev（Emerald Garden，含浅色 / 深色与移动端）。UI 大改后请同步更新。

提交信息沿用现有风格：`feat: / fix: / refactor: …`（中文描述）。
