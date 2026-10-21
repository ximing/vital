---
paths:
  - "packages/dto/**/*.ts"
  - "packages/api-client/**/*.ts"
  - "apps/server/src/**/*.routes.ts"
  - "skills/vital/**"
---

# API 契约、附件签名与外部 Skill 同步规范

## 1. `@vital/dto` 是唯一契约源

- 前后端（Web / Mobile / Extension / Server）共享的请求参数、响应体与枚举统一使用 Zod 定义在 `packages/dto/src/` 下，并从 `packages/dto/src/index.ts` 导出。
- 修改 `packages/dto` 后若下游类型检查未感知，先执行 `pnpm --filter @vital/dto build`。

## 2. 私有图片与附件 DTO 规则

- 任何包含可展示私有图片或附件的业务 DTO（如 `UserProfile.avatarUrl`、`InboxAsset.url` 等），必须在 DTO 中明确定义签名 URL 字段，并由服务端在序列化响应时生成有效期固定为 6 小时（`PRESIGN_GET_TTL_SECONDS=21600`）的 S3 签名 URL。
- 严禁让客户端直接请求受保护的 `/api/v1/uploads/:id` 渲染图片（浏览器 `<img>` 不会携带 Bearer Token），也禁止客户端自行下载 Blob 转 Object URL。
- 新增含附件的业务 DTO 时，必须同步补充对应的签名 URL 生成与测试。

## 3. 收集箱正文（Inbox Body）传输约定

- 列表、增量同步（`/api/v1/sync`）与搜索接口返回的 `InboxItem` 省略正文（`contentJson` / `extractedText`），只有单条详情 `GET /api/v1/inbox/:id` 及创建/更新接口加载正文。
- `@vital/api-client` 与客户端合并收件箱列表数据时，必须使用 `coalesceInboxBody` / `mergeInboxItems` 保留本地已缓存的正文。

## 4. 同步生成 `skills/vital` 参考文档

- `skills/vital/references/` 下的 API 域文档由脚本根据路由与 DTO 自动生成。
- 凡是新增、修改或删除了 `apps/server/src/**/*.routes.ts` 路由或 `packages/dto` 字段，完成后必须在仓库根目录执行：

```bash
pnpm gen:vital-skill
```

不要手动硬改自动生成的 `skills/vital/references/*.md` 字段表而跳过脚本生成。
