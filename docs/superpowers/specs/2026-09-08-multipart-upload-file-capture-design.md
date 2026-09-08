# 统一分片上传 + 直链文件转存收录 — 设计文档

日期：2026-09-08
状态：已获用户批准（含三处修正：分片 5MB、resumeId 续传方式、删旧 presign）

## 背景与问题

1. 扩展对 `.pdf`/视频等直链文件无识别能力：`https://x.com/a.pdf` 被当网页跑 Readability 解析，产出垃圾；图片右键虽有转存但受 10MB 限制。
2. 上传链路受 `MAX_IMAGE_BYTES = 10MB` 硬限；S3 multipart 骨架已在 storage 层存在（`initMultipart`/`presignPart`/`completeMultipart`/`abortMultipart`）但**无调用方**——service 层只有单 PUT presign，`uploadId` 字段从未写入。
3. 系统尚无用户，用户要求：所有上传调用点统一走分片模式，不留兼容层；断点续传必做。

## 目标

- 全端统一 multipart 上传：DTO / server / api-client / 四个调用点（web 头像、web 报告附件、mobile 头像、扩展图片转存）一套协议。
- 5GB 单文件上限、S3 协议分片（除尾片外 ≥5MB）、最多 10000 片。
- 断点续传：已传分片不重传，从断点继续。
- 扩展识别直链文件（PDF/视频/音频）并转存收录；web Reader 内嵌播放/预览。

## 非目标

- txt/md/代码/图片文件的「直链收录」——正文可承载，维持现状（图片右键转存已有）。
- 移动端直链文件收录（mobile 无扩展场景）。
- 后台并行多片上传（逐片串行，简单可控）。
- 兼容旧 presign 单 PUT 流程（整体删除）。

## MIME 集合

`ATTACHMENT_MIME_TYPES` 在现有基础上增加：

- `application/pdf`（已有）
- 视频：`video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`
- 音频：`audio/mpeg`, `audio/mp4`, `audio/aac`, `audio/ogg`, `audio/wav`, `audio/flac`

新常量（DTO `uploads.ts`）：

- `MAX_UPLOAD_BYTES = 5 * 1024^3`（5GB，替换 `MAX_IMAGE_BYTES` 的上限语义）
- `MIN_UPLOAD_PART_BYTES = 5 * 1024 * 1024`（S3 协议：除尾片外每片 ≥5MB）
- `MAX_UPLOAD_PARTS = 10000`（S3 协议上限）
- 分片大小由服务端计算：`partSize = max(5MB, ceil(size / 10000))`；`totalParts = ceil(size / partSize)`；单片文件（size ≤ partSize）= 1 片。

用户原始要求为 2MB/片；S3 multipart 协议强制每片（除尾片）≥5MB，故取 5MB。已与用户确认。

## ① 上传协议（DTO + server）

路由（全部 requireAuth）：

```
POST /api/v1/uploads                     { mime, size, filename?, resumeId? }
  → 201 { id, uploadId, partSize, totalParts, parts: [{partNumber, size}] }
     // initMultipart（或 resumeId 命中则复用会话并附带已传分片）
     // 校验：mime ∈ ATTACHMENT_MIME_TYPES、size ≤ MAX_UPLOAD_BYTES
     // resumeId 语义：attachments.id，须 status=uploading 且 mime/size 匹配，否则 409 新建
GET  /api/v1/uploads/:id/parts
  → { parts: [{partNumber, size}] }      // ListParts 结果，续传跳过
POST /api/v1/uploads/:id/parts/:partNumber
  → { url, expiresIn }                    // presignPart；partNumber ∈ [1, totalParts]
POST /api/v1/uploads/:id/complete        { parts: [{partNumber, etag}] }
  → { id, status: 'ready', mime, size, ownerType: 'tmp' }
     // completeMultipart（ETag 齐全性校验）→ HEAD 校验 size/contentType → ready
POST /api/v1/uploads/:id/abort           → 204（abortMultipart + 状态 orphaned）
POST /api/v1/uploads/:id/bind            → 不变
DELETE /api/v1/uploads/:id               → 不变（discard）

删除：`GET /api/v1/uploads/:id` 302 跳转端点（`resolveAccessUrl` service 函数保留，供内部生成签名 URL）。全站文件访问统一走签名 URL，不做 302 跳转。
```

删除：`POST /uploads/presign` 路由与 `presignUpload` service；`presignPut` adapter 方法（含 base.adapter 抽象与 s3/local 实现）。

service 层新增：

- `initUpload(userId, {mime, size, filename?, resumeId?})`：写入 attachments（`uploadId` 真正启用）；resumeId 命中时校验归属/状态/mime/size 并直接 ListParts 返回
- `listUploadedParts(userId, id)`：`storage.listParts(s3Key, uploadId)`（**adapter 新增方法**，s3 实现 `ListPartsCommand`）
- `presignPartUpload(userId, id, partNumber)`：校验 partNumber 范围 + status=uploading
- `completeMultipartUpload(userId, id, parts)`：parts 必须覆盖 [1..totalParts] 无缺漏 → completeMultipart → HEAD 校验（复用现有逻辑）→ ready

sweeper 不变（uploading 超时 → abortMultipart；uploadId 现在真的有值）。

## ② api-client `upload()` 重写（统一入口）

```ts
upload({ file? | fileUri?, mime, size, onProgress?, signal?, resumeId? })
  → POST /uploads（init/恢复）→ GET /parts（若恢复）→ 逐片 [presign → PUT] → complete
  → onProgress(loaded, total)（片完成粒度）
  → 返回 UploadCompleteResponse（形状不变）
```

- 分片读取：`file.slice(offset, offset+partSize)`（web/扩展 Blob）；mobile fileUri 路径分段读（`FilePart {fileUri, start, end, size, mime}` 现有结构逐片复用）。
- PUT 一律 fetch（删除 `xhrPut`/`fetchPut` 双轨与 `putWithProgress` 选项——片粒度进度已够）。
- ETag 从 PUT 响应 header 提取（`ETag`，含引号原样回传）。
- 断点续传：`resumeId` 传入 → init 返回已传 parts → 跳过。重试时调用方持久化 resumeId（扩展场景必须；web/mobile 小文件一次性场景不传即可）。
- 旧 `MAX_IMAGE_BYTES`/单 PUT 相关客户端校验替换为 `MAX_UPLOAD_BYTES`。

## ③ 扩展端直链文件收录

识别（纯函数 `src/file-kind.ts`，可单测）：

- URL pathname 扩展名 ∈ `{pdf, mp4, webm, mov, m4v, mkv, mp3, m4a, aac, ogg, wav, flac}` → 候选文件
- `extractCapture` 对候选 fetch 源 URL 读响应头：`Content-Type` ∈ 允许 MIME + `Content-Length ≤ MAX_UPLOAD_BYTES` → 文件模式；否则回退文章模式（现流程不变）

弹窗（`PopupMode` 增加 `'file'`）：

- 文件模式：隐藏三模式切换与清单下拉，显示 文件名（可编辑标题）+ 类型/大小 + 备注 + 保存
- 进度：`progressLabel(done, total)` 复用，文案 `转存 n/N 片`

静默路径：

- 右键直存（页面/链接）命中文件直链 → 同样转存，badge `n/m`（badgeText 4 字符截断维持）

流式转存（SW 内）：

- `fetch(srcUrl).body`（ReadableStream）逐片读 → 逐片 `client.upload` 分片序列 → 内存常驻 ≤1 片
- CORS 拒绝（fetch 抛错）→ 降级：仅创建 inbox item（originalUrl=直链，无 asset），Reader 用原 URL 内嵌
- 续传：attachmentId + 已传分片集存 `chrome.storage.session`（key = canonical URL）；重试带 resumeId

`commitCapture` 增加 file 分支：`createExtensionItem`（title=文件名，originalUrl=直链）→ 转存 → `patchInboxAssets`。

## ④ Reader 内嵌（web）

- `InboxAsset` 返回体增加 `mime` 字段（inbox service join attachments 带出；DTO/接口同步）
- 渲染规则（ReaderArticle 顶部资源区）：
  - `application/pdf` → `<iframe src={signedUrl}>`（浏览器原生渲染，占 Reader 内容宽度，高度 70vh）
  - `video/*` → `<video controls src={signedUrl}>`
  - `audio/*` → `<audio controls src={signedUrl}>`
  - 图片维持现行为（assets gallery）
- 签名 URL：reader 数据接口为 asset 附带签名 URL（服务端 `generateAccessUrl`，六小时），一次性下发。媒体元素（`<video>`/`<iframe>`）无法带 Authorization header，签名 URL 直发是唯一可行方式。`InboxAsset` 返回体相应增加 `url` 字段（签名 URL）。
- **全站统一**：删除 `GET /uploads/:id` 302 跳转端点与 `api-client.uploadUrl()`（无调用方）；avatar 已走 `toProfile` 的签名 URL（六小时）不变。所有文件访问一律签名 URL。

## ⑤ 错误与边界

- resumeId 不匹配（mime/size/status）→ 409 `MEDIA_INVALID_STATE`，客户端按新上传处理
- complete 时 ETag 缺漏 → 422
- HEAD 校验 size/contentType 不符 → 422（复用现有 `MEDIA_MISMATCH`）
- 超过 5GB → 413（`MEDIA_TOO_LARGE`）
- 转存中断（扩展 SW 被杀）→ 已传片在 S3 + attachmentId 在 session storage，下次重试 resume
- S3 ListParts 在 abort 后调用 → 客户端收 409，重新 init

## 测试

- DTO：MIME 集合、5GB 上限、partSize 计算、请求/响应 schema
- server：initUpload/resume、listParts、presignPart 越界、complete ETag 校验、abort、sweeper（uploadId 非空场景）
- api-client：分片循环、续传跳片、进度回调、ETag 提取（mock http）
- 扩展：file-kind 识别/回退、CORS 降级、popup file 模式、静默 badge
- web：Reader mime 分支渲染

## 改动文件清单（概要）

- `packages/dto/src/uploads.ts`：常量、MIME、multipart schema；`packages/dto/src/inbox.ts`：`InboxAsset.mime`
- `apps/server/src/storage/base.adapter.ts` + `s3.adapter.ts`（+local）：`listParts`，删 `presignPut`
- `apps/server/src/uploads/uploads.service.ts` + `uploads.routes.ts`：新四路由，删 presign
- `packages/api-client/src/upload.ts` + `client.ts`：upload() 重写；删 default-put.ts
- `apps/extension/src/file-kind.ts`（新）、`capture.ts`、`popup-state.ts`、`entrypoints/popup/`、`messages.ts`
- `apps/web/src/features/inbox/`：Reader asset 渲染
- 数据库：attachments 表无迁移（uploadId 已存在）；inbox service join 改动无 schema 变化

## 风险与权衡

- **删旧 presign**：无用户，四个调用点同一 PR 内统一切换。风险集中在 api-client 重写，靠单测覆盖。
- **签名 URL 有效期**：六小时（与 avatar 一致）。超时后 reader 重新拉取数据即刷新；扩展转存后的 Reader 访问不依赖转存时的 URL。
- **SW 生命周期**：5GB 转存逐片串行可能超 SW 30s 空闲回收——每片上传的 fetch 活动会重置 SW 计时器（扩展 API 场景持续活动保活）；转存中断亦有续传兜底。
- **断点续传以 S3 ListParts 为权威**：服务端不存分片状态表，GET /parts 实时查询。简单、无一致性风险。
