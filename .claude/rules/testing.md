---
paths:
  - "**/__tests__/**/*.ts"
  - "**/__tests__/**/*.tsx"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.test.mjs"
---

# 测试编写与测试数据库规范

## 1. 服务端测试数据库（`vital_test`）

- 服务端测试直接连接 `vital_test` PostgreSQL 数据库（本机配置保存在被 Git 忽略的 `apps/server/.env.test` 中）。
- **严禁提交敏感凭据**：不得将测试库密码、JWT 密钥、Cookie 密钥或对象存储密钥写入受版本控制的文件。
- **不要硬编码连接假设**：测试环境的主机、端口与 SSL 配置由环境变量或部署环境提供，不能在测试代码中写死为本机回环地址。
- **迁移与清理闭环**：`pnpm --filter @vital/server test` 会在运行 Vitest 前自动执行数据库迁移；测试通过 `apps/server/__tests__/helpers/db.ts` 中的 `resetDb()` 显式清空所有表（因为无外键级联删除，新增表必须同步加入 `resetDb()`）。

## 2. 客户端与包单元测试（Vitest）

- Web、Mobile、Extension 及 `packages/*` 均使用 Vitest 运行测试。
- 在测试 `@rabjs/react` 的 Service 或 UI 组件时，确保每个测试用例前后重置服务状态（如调用 `resetInboxUi()` 或对应的 `service.reset()`），避免跨用例状态污染。
- 涉及私有附件或图片的 DTO / 组件测试，需验证签名 URL 字段存在性以及加载失败时的本地占位回退行为。
