# 部署准备与配置

生产环境是 GHCR 上的 `vital-server` 镜像，加上一台入口 Nginx 和外部 PostgreSQL。镜像在 `main` 上由 [Build and Push Docker Images](../.github/workflows/docker-build.yml) 打出，标签含 `stable`。Android 安装包和桌面壳是另外两条 Actions，不进这个镜像。

密钥只放在宿主机的 `.env` 和 GitHub Actions Secrets 里。`.env`、`apps/server/.env*`、`apps/mobile/agconnect-services.json` 都不入库。

## 要准备的东西

| 东西 | 用途 |
| --- | --- |
| PostgreSQL 16，已装 `pg_trgm` | 业务库。表没有外键，迁移由镜像里的 `migrate` 执行 |
| 对象存储（S3 兼容） | 头像、收集箱图片、报告图片。客户端只拿服务端签好的 URL |
| 域名和 TLS | 当前站点是 `https://vital.aimo.plus`。`WEB_ORIGIN` 必须等于浏览器看到的源，刷新 Cookie 才下得来 |
| 入口反代 | 把 `https://vital.aimo.plus` 转到应用机的 `13005`。`TRUST_PROXY_EXTRA` 填入口机地址，示例 `203.0.113.10` |
| GHCR 拉取权限 | 应用机能拉 `ghcr.io/ximing/vital-server:stable` |
| AppGallery Connect 项目 Vital | 包名 `plus.aimo.vital`，开通推送。应用级 OAuth 密钥给 worker |
| 正式签名证书 | 已有的 GitHub Secret `ANDROID_KEYSTORE`。华为后台要填这张证书的 SHA-256 |

模型密钥不在部署环境里配。每个账号在 **设置 → 模型** 里填写。检索（DashScope / Qdrant / Meilisearch）可以不配，对应能力会关掉。

## 服务端

在应用机的 compose 目录：

```bash
cp .env.production.example .env
```

填完后：

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d
```

`docker-compose.prod.yml` 是当前线上拓扑：镜像同时提供 API 和网页静态文件，入口 Nginx 反代到 `${VITAL_WEB_PORT:-13005}`。`docker-compose.prod.external.yml` 只跑 API 和 worker，并把端口绑在本机 `127.0.0.1:3010`，网页由宿主机 Nginx 另提供。两份 compose 都读同一个 `.env`。`migrate` 成功退出之后，server 和 worker 才会启动。

worker 是同一个镜像的第二个进程，提醒和后台 Agent 都在这里跑。改环境变量或 schema 之后要重启它，API 进程不会带上 worker。

必填：

| 变量 | 说明 |
| --- | --- |
| `PG_HOST` `PG_PORT` `PG_USER` `PG_PASSWORD` `PG_DATABASE` | 应用机要能连到这台库。`PG_SSL` 按库的要求 |
| `JWT_SECRET` `COOKIE_SECRET` | 各自至少 32 字符，彼此不同。`openssl rand -base64 48` |
| `WEB_ORIGIN` | `https://vital.aimo.plus`。和证书上的主机名一致 |
| `COOKIE_SECURE` | 生产为 `true`。明文 HTTP 下刷新 Cookie 不会写入 |
| `ATTACHMENT_S3_*` | 桶、前缀、区域、Endpoint、访问密钥。生产前缀用 `prod/attachments`，和开发分开 |
| `TRUST_PROXY_EXTRA` | 入口反代的地址，逗号分隔。示例 `203.0.113.10` 不是真机，不填则只信任本机和 Docker 网桥 |

常用但有默认值：`PORT=3010`、`ACCESS_TOKEN_TTL_SECONDS=900`、`REFRESH_TOKEN_TTL_DAYS=30`、`PRESIGN_GET_TTL_SECONDS=21600`、`WORKER_POLL_MS=15000`、`AGENT_DAILY_MODEL_CALL_LIMIT=100`。Agent 调度项见 [agent-scheduling.md](agent-scheduling.md)。

健康检查：`GET /api/health` 看进程，`GET /api/v1/health/ready` 做 `SELECT 1`。

## 只有链接的收藏

扩展不进这个镜像。浏览器里已经打开的页面仍由扩展自己解析。容器要补的是服务端兜底，两条路径用同一张 `vital-server` 镜像：

| 进程 | 做什么 |
| --- | --- |
| `server` | 粘贴链接时 `POST /api/v1/inbox/extract` 当场抓取 |
| `worker` | 定期修复里补已经存下来、正文还空着的 http(s) 收藏。默认约 5 分钟一轮，每轮 2 条 |

不要另起 `h4ckf0r0day/obscura` 容器，也不要暴露 9222。API 和 worker 各自启动本机的 `obscura` 命令，用完即退。二进制缺失时退回普通 HTTP；静态 HTML 里已经有正文的页面（例如这次测过的微信文章）仍能解析，靠脚本才出现正文的页面则不能。生产镜像要带上二进制。

### 镜像里多出来的包

`@vital/article-extract` 是新的 workspace 包，运行时还要它依赖的 `@vital/article-html`。`apps/server/Dockerfile` 的 COPY 白名单要补上，否则安装阶段会断，或者镜像能构建、上线后 `ERR_MODULE_NOT_FOUND`。web 构建用不到它们。

| 阶段 | 补什么 |
| --- | --- |
| `deps`、`prod-deps` | 两个包的 `package.json` |
| `build` | 两个包的源码，并在 server 构建前先 `pnpm --filter @vital/article-html build`，再 `pnpm --filter @vital/article-extract build` |
| `runtime` | 从 `prod-deps` 拷包目录，从 `build` 覆盖各自的 `dist`。和现有的 `article-doc` 一样 |

`jsdom` 已经在 server 依赖里。Readability 跟着 `@vital/article-extract` 的生产依赖装进镜像。

### Obscura 二进制

镜像构建平台是 `linux/amd64`，基础镜像 `node:22-bookworm-slim` 的 glibc 满足 Obscura 对 2.35+ 的要求。在 `runtime` 阶段装固定版本，不要用 `latest`。用 v0.2.3：这一版修了脚本引擎、并发会话和渲染正确性，我们调用的 `fetch`、`--quiet`、`--timeout`、`--wait`、`--wait-until`、`--user-agent`、`--eval` 都还在，`OBSCURA_NAV_TIMEOUT_MS`、`OBSCURA_FETCH_TIMEOUT_MS`、`OBSCURA_SCRIPT_DEADLINE_MS` 也还在。CDP / MCP 的令牌要求只作用于对外暴露的 `serve` / `mcp`，一次一退的 `fetch` 用不到。本机用这一版的 macOS 构建、同样的参数并且不走代理，抓过同一篇微信文章，解析结果仍是标题「终篇，Oh My Pi：把 Pi 变成真正的 AI 工作台」、作者「硅基铁匠」。

```bash
curl -fsSL -o /tmp/obscura.tar.gz \
  https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.3/obscura-x86_64-linux.tar.gz
tar -xzf /tmp/obscura.tar.gz -C /usr/local/bin obscura obscura-worker
rm /tmp/obscura.tar.gz
```

两个文件放在同一目录。`OBSCURA_BIN` 默认就是 `obscura`，在 `PATH` 上时不用写进 `.env`。换版本时改这个 URL，并再抓一篇微信文章确认正文还在。

抓取时进程会清掉传给子进程的 `http_proxy`、`https_proxy`、`all_proxy`、`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`OBSCURA_PROXY`。普通 HTTP 回退连的是事先查好的公网地址，也不走代理。微信走本机代理时 TLS 会失败。compose 里 `worker` 已经把这些变量置空（MeoW 也要直连）。`server` 服务要同样置空，避免宿主机 `.env` 里的代理进容器。不要加 `--proxy`，不要加 `--allow-private-network`。容器出网必须能直接访问公网。

第一次抓取大约十几秒：等 `DOMContentLoaded`，并限制卡住的子资源和超大内联脚本。正文仍空时再放宽时间重试一次。最慢会先用满约 20 秒，再重试约 25 秒，然后才用普通 HTTP（10 秒）。入口 Nginx 对 `/api/` 的 `proxy_read_timeout` 至少留 90 秒，避免粘贴预览被反代掐断。请求体只是一个 URL，不用加大上传体积限制。2MB 限制的是提出来的正文；原始 HTML 里的脚本可以更大，进程最多读 16MB 再解析。

### 发布时多做的检查

迁移 `0046_link_extract_attempt` 增加可空列 `link_extract_attempted_at`。仍是先 `migrate` 成功，再启动 server 和 worker。worker 必须换成带这个列的新镜像。

验收：`docker exec vital-server obscura --version` 打印 `0.2.3`，`vital-worker` 里同一条命令结果相同。用一篇公网微信文章走粘贴预览，正文应写入预览而不是只留下链接。登录才能看的站点，以及藏在 Shadow DOM 里的内容，仍然拿不到。

## 华为推送

推送由 **worker** 发给华为，再由华为投到手机通知栏。服务器用的是应用的 OAuth 客户端，不是用户的华为账号。手机登录 Vital 之后，把华为发给这台安装的 token 登记到 `push_devices`，一行 token 只属于最后登录的那个账号。

### AppGallery Connect

项目 **Vital**，Android 应用包名 `plus.aimo.vital`。

1. **项目设置 → 常规 → 应用**，给这张正式签名证书加上 SHA-256 指纹。指纹来自 GitHub Actions 打出的 APK，不是本机 debug keystore：

   ```bash
   apksigner verify --print-certs app-release.apk
   ```

   把输出里的 SHA-256 写成冒号分隔的十六进制，填进「SHA256证书指纹」。

2. **增长 → 推送服务** 保持开通。**配置** 里选中应用 Vital。数据存储位置选中国后，按主题或设备组发送才可用；按 token 发提醒不依赖这项。

3. 同一页申请 **自分类权益**，消息类型用「工作事项提醒」。审核通过后要点 **激活**。没激活时，华为把通知当成资讯营销，同一台手机一天大约只放行 2 条。服务端发送时带的类别是 `WORK`。

应用 ID 是 `119138157`。推送 OAuth 用这个应用级客户端。`agconnect-services.json` 里的 `client.client_secret` 是项目级密钥，拿它换 token 会失败。

### worker 环境变量

写在应用机的 `.env`，和 compose 共用。改完执行 `docker compose -f docker-compose.prod.yml up -d worker`。

```bash
HUAWEI_PUSH_CLIENT_ID=119138157
HUAWEI_PUSH_CLIENT_SECRET=<应用级 OAuth 密钥>
```

两项都空着时，worker 跳过华为发送，其余提醒渠道照常。密钥只放在这台机器上，不进镜像，也不进安装包。

MeoW 是另一条渠道：用户在设置里填昵称，worker 用 `MEOW_BASE_URL` 调用。它和华为推送互不影响。

### 手机上会发生什么

正式包 `plus.aimo.vital` 在登录、注册、以及已登录回到前台时，向 `POST /api/v1/push-devices` 登记 token。请求走当前登录会话，所以设备挂在这个 Vital 账号下。退出登录不会删掉这行；这台手机再用另一个账号登录时，会改挂到新账号。

Expo Go 拿不到华为 token。点通知打开 `vital://task/<任务>`、`vital://day/<日子>` 或 `vital://today`，应用回到首页并打开对应内容。习惯提醒的目标也是那条习惯任务。

## Android 安装包

Actions 里手动运行 **Build Android Release APK**，或在发布 GitHub Release 时自动跑。仓库 Secrets：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE` | 正式 keystore 的 base64，一行 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 密钥别名 |
| `ANDROID_KEY_PASSWORD` | 密钥密码 |
| `AGCONNECT_SERVICES_JSON` | `agconnect-services.json` 的 base64，一行，不要换行 |
| `EXPO_PUBLIC_API_URL` | 可选。空着则用 `https://vital.aimo.plus` |

打包前 workflow 把 `AGCONNECT_SERVICES_JSON` 解码到 `apps/mobile/agconnect-services.json`，prebuild 再把它拷进 Android 工程并接上华为 Push SDK。这四个签名 Secret 已经在仓库里，换证书时才改。

`agconnect-services.json` 从 AppGallery Connect 的应用页下载。本机文件放在 `apps/mobile/agconnect-services.json`，已被 gitignore。

桌面壳由 **Build Desktop** 打出，加载的是线上网页。地址用仓库变量或 Secret `VITAL_WEB_URL`，默认 `https://vital.aimo.plus`。

## 发版时的顺序

1. `main` 上的镜像构建完成，`ghcr.io/ximing/vital-server:stable` 已更新。
2. 应用机拉取镜像，先跑 `migrate`，再 `up -d`。schema 有变时确认 worker 已换成新进程。
3. 需要新安装包时再跑 Android workflow。华为指纹和 OAuth 密钥没变就不用改后台。
4. 手机装上新包并登录一次，确认 `push_devices` 里有这个账号的 `huawei` 行。
