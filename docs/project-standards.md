# Vital 项目工程规范

## 数据库（无外键）

- 表之间 **不建 PostgreSQL 外键**。归属、存在性和级联删除都在服务层完成。
- 一次业务写入如果动到两张及以上的表，必须包在同一个 `getDb().transaction` 里；库不会 `CASCADE` / `SET NULL`。
- 硬删父行时，同一事务里显式删掉或置空子行（标签连接表、通知投递、习惯实例、`user_llm_routes`、线程上的 `outcome_id` 等）。软删（`deleted_at`）可以保留子行。
- 新增表后更新 `apps/server/__tests__/helpers/db.ts` 的 `resetDb()`，以及 eval fixture 里按用户清理的路径。
- 改 schema 之后必须重启 worker（`pnpm --filter @vital/server worker`）。API 的 `tsx watch` 不会重载 worker；旧进程继续查询已删除列会导致 Agent 调度和通知派发每轮失败。

## 测试数据库

- 服务端测试直接连接共享的 `vital_test` 数据库；不依赖 Docker 或本机 Compose。
- 本机私密配置保存在被 Git 忽略的 `apps/server/.env.test`；不得提交密码、JWT、Cookie 或对象存储密钥。
- 运行服务端测试前先执行迁移；测试结束由现有 `resetDb()` 清理数据。
- 测试环境的主机、端口、SSL 设置由部署提供，不能假设为本机回环地址。

## 私有图片与附件

- 所有可展示的私有图片都由服务端在业务 DTO 序列化时生成 S3 签名 URL。
- 签名 URL 的有效期固定为 6 小时（`PRESIGN_GET_TTL_SECONDS=21600`）。
- 客户端只能直接渲染业务响应中的 URL，例如 `UserProfile.avatarUrl` 与 `InboxAsset.url`。
- 禁止把受保护的 `/api/v1/uploads/:id` 直接赋给 `img.src`；浏览器图片请求不会携带 Bearer Token。
- 禁止为显示私有图片在客户端下载 Blob、创建 Object URL 或暴露访问令牌。
- 图片加载失败必须回退到安全的本地占位内容；头像回退为用户显示名首字母。
- 新增任何包含附件的业务 DTO 时，必须同时定义并测试签名 URL 字段。

## 视觉实现

- 工作区保持 rail / library / canvas 结构；library 与 canvas 必须以 `min-h-0 flex-1` 填满可用高度。
- 阅读、写作和任务主表面不使用装饰性边框；通过 Mineral Garden 背景层级、间距和排版表达结构。
- 日期、时间、日期时间控件必须复用 `FIELD_CONTROL_CLASS` 与 `FIELD_POPOVER_CLASS`，保持相同高度、圆角、焦点和弹层行为。

