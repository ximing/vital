---
paths:
  - "apps/server/src/db/**/*.ts"
  - "apps/server/src/**/*.service.ts"
  - "apps/server/drizzle/**"
---

# 数据库与无外键事务规范

## 1. 严禁 PostgreSQL 外键

- 所有表之间**不建数据库级外键**，禁止在 Drizzle Schema（`apps/server/src/db/schema/**`）中使用 `.references()`。
- `user_id` 与各类 `*_id` 字段均为普通 `char(36)`。数据归属、目标行存在性校验、以及级联清理全部由服务层（`*.service.ts`）负责。

## 2. 跨表操作单事务原则

- 任何涉及两张及以上表的写操作（父表 + 子表、多对多连接表、outbox 投递表、历史/审计表、Agent 调度状态表）**必须在同一个 `getDb().transaction` 中执行**。
- 写入任何关联 ID 前，必须先校验被引用记录存在且 `user_id` 与当前操作用户一致。

## 3. 硬删除父记录的级联清理清单

数据库不会自动执行 `ON DELETE CASCADE` 或 `SET NULL`。硬删除父记录时，必须在**同一事务**内显式清理子记录（软删除 `deleted_at` 可保留子记录以便恢复）：

| 删除目标 | 同一事务内必须同步处理的关联表 / 字段 |
| --- | --- |
| `tag` | 删除 `task_tags`、`inbox_item_tags` 关联行 |
| `notification_channel` | 删除对应的 `notification_deliveries` |
| `habit` | 软删除未完成的习惯任务实例，并将其余关联行的 `habit_id` / `habit_key` 置空 |
| `user_llm_provider` | 清理指向该 provider 的 `user_llm_routes` |
| Agent 创建的 `outcome`（撤销） | 将关联 `tasks`、`inbox_items`、`habits` 上的 `outcome_id` 置空 |
| `user`（仅测试 / eval） | 清理所有带 `user_id` 的业务与 Agent 表 |

## 4. Schema 变更后的必做事项

1. **更新测试清理**：新增任何表后，必须同步加入 `apps/server/__tests__/helpers/db.ts` 的 `resetDb()` 删除列表（以及 eval fixture 的按用户清理逻辑）。
2. **重启 Worker 进程**：修改 `apps/server/src/db/schema/**` 并执行迁移后，**必须重启后台 worker**（`pnpm --filter @vital/server worker`）。API 的 `tsx watch` 会自动重载，但存活的旧 worker 进程若继续查询已删除/改名列，会导致 Agent 调度与通知派发每轮失败。
