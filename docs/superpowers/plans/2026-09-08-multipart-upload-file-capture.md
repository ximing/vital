# 统一分片上传 + 直链文件转存收录 Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全端统一 S3 multipart 分片上传（5GB 上限、断点续传、删除旧 presign 单 PUT 与 302 端点），扩展识别直链文件（PDF/视频/音频）转存收录，web Reader 内嵌播放/预览。

**Architecture:** DTO 定义新协议常量与 schema → storage 层补 `listParts` 删 `presignPut` → server uploads service 四路由（init/presign-part/complete/abort）+ 签名 URL JSON 端点 → api-client `upload()` 重写为分片循环（resumeId 续传 + 409 回退 + 注入 fetch）→ 扩展 `file-kind.ts` 识别 + SW 流式转存（字节对齐的 partSource）+ popup file 模式 → web Reader mime 分支渲染 + 报告编辑器渲染层换签名 URL → mobile partSource 适配。

**Tech Stack:** zod、drizzle、AWS SDK v3（S3 presigner）、vitest、WXT MV3 service worker。

**Spec:** `docs/superpowers/specs/2026-09-08-multipart-upload-file-capture-design.md`（含 rev2 修订：报告 302 迁移方案见 Task 8，历史数据零迁移）

## Global Constraints

- ~~工作区有用户未提交 WIP~~ **rev2：用户 WIP（inbox wechat）已落盘为 commit `6334a0a`，工作区干净。** 提交时仍只 `git add` 本任务列出的文件（防御性习惯）。
- **分片大小**：`MIN_UPLOAD_PART_BYTES = 5MB`，`MAX_UPLOAD_PARTS = 10000`，`MAX_UPLOAD_BYTES = 5GB`。partSize 由服务端算：`max(5MB, ceil(size/10000))`。
- **MIME 集合**：`ATTACHMENT_MIME_TYPES` = 现有六图 + `application/pdf` + `text/plain` + `text/markdown`（已有）+ 新增 `video/mp4, video/webm, video/quicktime, video/x-matroska, audio/mpeg, audio/mp4, audio/aac, audio/ogg, audio/wav, audio/flac`。SVG 仍排除。
- **错误码约定**（server service 层显式抛，不依赖 zod 映射——zod 全部映射 400 VALIDATION_ERROR）：mime 白名单 → 422 `MEDIA_MISMATCH`；size 超限 → 413 `MEDIA_TOO_LARGE`；状态非法/不匹配 → 409 `MEDIA_INVALID_STATE`；分片号越界 → 422 `MEDIA_PART_INVALID`；complete 缺 ETag → 422 `MEDIA_PART_MISSING`；HEAD 不符 → 422 `MEDIA_MISMATCH`。
- **`UploadedPart` 统一定义（含 ETag，全链路唯一权威）**：`{ partNumber: number; size: number; etag: string }`。S3 ListPartsCommand 的 `Part.ETag` 是 complete 需要全量 ETag 的唯一来源，续传跳片的 ETag 由 init/parts 响应携带。
- **不留兼容**：删 `presignUpload`/presign 路由/`presignPut` adapter 方法/`xhrPut`/`fetchPut`/`putWithProgress` 选项/`fileUri` 形态/`GET /uploads/:id` 302 路由/`api-client.uploadUrl()`。
- **文件访问一律签名 URL**；报告 markdown 里持久化的是稳定引用 `/api/v1/uploads/<id>`（**不迁移历史数据**），渲染层换签名 URL（新 JSON 端点）。
- 测试命令（仓库根）：`pnpm --filter @vital/dto test`、`pnpm --filter @vital/api-client test`、`pnpm --filter @vital/server test`、`pnpm --filter @vital/extension test`、`pnpm --filter @vital/web test`；typecheck 各包 `pnpm --filter <pkg> typecheck`。
- 扩展不引入 React；文案中文集中 `apps/extension/src/i18n.ts`。
- 提交信息 conventional commits + `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- server 测试基建：`installMockStorage()`（`apps/server/__tests__/helpers/storage.ts`）mock 全部 adapter 方法；`injectJson(app, {method, url, token, payload})`（`helpers/http.ts`，GET 不传 payload）。
- api-client 测试基建：`respond`/`urlOf`/`bodyOf`（`packages/api-client/__tests__/test-helpers.ts`）；S3 PUT 的 mock 必须带 ETag header：`new Response(null, { status: 200, headers: { ETag: '"e1"' } })`。
- 基线（开工前已验证全绿）：dto 45、server 136、web 123、extension 37、api-client（含既有用例）。任何包新失败即回归。

---

### Task 1: DTO — 常量、MIME、multipart 协议 schema（含 ETag）

**Files:**
- Modify: `packages/dto/src/uploads.ts`
- Test: `packages/dto/__tests__/uploads.test.ts`（新建）

**Interfaces:**
- Consumes: 无（首个任务）。
- Produces:
  - `MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024`、`MIN_UPLOAD_PART_BYTES = 5 * 1024 * 1024`、`MAX_UPLOAD_PARTS = 10_000`
  - `partSizeFor(size): number`、`totalPartsFor(size): number`
  - `isUploadableMime(mime: string): boolean`
  - `UploadedPart { partNumber: number; size: number; etag: string }`
  - `uploadInitInputSchema`（mime/size/filename?/resumeId?，**不含** superRefine mime 检查与 size 上限——server service 层显式抛 422/413，schema 只做形状）
  - `UploadInitResponse { id; uploadId; partSize; totalParts; parts: UploadedPart[] }`
  - `UploadPartsResponse { parts: UploadedPart[] }`、`PartPresignResponse { url; expiresIn }`
  - `uploadCompletePartsInputSchema`（parts min 1 max 10000）
  - `UploadUrlResponse { url: string; expiresIn: number }`（Task 8 签名 URL JSON 端点用）
  - `UploadCompleteResponse` 形状不变；`UploadInput`（api-client）见 Task 5

**注意**：本任务**不动 `packages/dto/src/inbox.ts`**（`InboxAsset.mime` 挪到 Task 4，避免 server typecheck 暂红窗口）。

- [ ] **Step 1: Write the failing test**

新建 `packages/dto/__tests__/uploads.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_PARTS,
  MIN_UPLOAD_PART_BYTES,
  isUploadableMime,
  partSizeFor,
  totalPartsFor,
  uploadInitInputSchema,
  uploadCompletePartsInputSchema,
} from '../src/uploads.js';

const UUID = '1b671a64-40d5-491e-99b0-da01ff1f3341';

describe('upload constants and mime', () => {
  it('includes video and audio mimes, still no svg', () => {
    for (const mime of [
      'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
      'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/flac',
    ]) {
      expect(ATTACHMENT_MIME_TYPES).toContain(mime);
      expect(isUploadableMime(mime)).toBe(true);
    }
    expect(isUploadableMime('image/svg+xml')).toBe(false);
    expect(isUploadableMime('application/x-msdownload')).toBe(false);
  });

  it('caps single file at 5GB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 ** 3);
  });
});

describe('part sizing', () => {
  it('small files use the 5MB minimum', () => {
    expect(partSizeFor(1024)).toBe(MIN_UPLOAD_PART_BYTES);
    expect(totalPartsFor(1024)).toBe(1);
    expect(totalPartsFor(MIN_UPLOAD_PART_BYTES)).toBe(1);
    expect(totalPartsFor(MIN_UPLOAD_PART_BYTES + 1)).toBe(2);
  });

  it('huge files stay within the 10000-part S3 limit', () => {
    const size = MAX_UPLOAD_BYTES;
    // 5GB / 10000 = ~524KB < 5MB, so the 5MB floor wins at the cap.
    expect(partSizeFor(size)).toBe(MIN_UPLOAD_PART_BYTES);
    expect(totalPartsFor(size)).toBe(Math.ceil(size / MIN_UPLOAD_PART_BYTES));
    expect(totalPartsFor(size)).toBeLessThanOrEqual(MAX_UPLOAD_PARTS);
  });
});

describe('multipart schemas', () => {
  it('init accepts shape with optional resumeId (valid uuid)', () => {
    expect(uploadInitInputSchema.parse({ mime: 'video/mp4', size: 1000 })).toEqual({
      mime: 'video/mp4', size: 1000,
    });
    expect(
      uploadInitInputSchema.parse({ mime: 'application/pdf', size: 10, resumeId: UUID }),
    ).toMatchObject({ resumeId: UUID });
    expect(
      uploadInitInputSchema.safeParse({ mime: 'video/mp4', size: 'big' }).success,
    ).toBe(false);
    expect(
      uploadInitInputSchema.safeParse({ mime: 'video/mp4', size: 10, resumeId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('complete parts need 1..10000 parts', () => {
    expect(
      uploadCompletePartsInputSchema.parse({ parts: [{ partNumber: 1, etag: '"e1"' }] }),
    ).toEqual({ parts: [{ partNumber: 1, etag: '"e1"' }] });
    expect(uploadCompletePartsInputSchema.safeParse({ parts: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vital/dto test`
Expected: FAIL — `partSizeFor` 等不存在。

- [ ] **Step 3: Write minimal implementation**

`packages/dto/src/uploads.ts`：

1. 常量（放 `MAX_IMAGE_BYTES` 之后；`MAX_IMAGE_BYTES` 保留原样，Task 9 统一清理）：

```ts
/** Single-file upload cap (5GB). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
/** S3 multipart: every part except the last must be at least 5MB. */
export const MIN_UPLOAD_PART_BYTES = 5 * 1024 * 1024;
/** S3 multipart hard part-count limit. */
export const MAX_UPLOAD_PARTS = 10_000;

export function partSizeFor(size: number): number {
  return Math.max(MIN_UPLOAD_PART_BYTES, Math.ceil(size / MAX_UPLOAD_PARTS));
}

export function totalPartsFor(size: number): number {
  if (size <= 0) return 0;
  return Math.ceil(size / partSizeFor(size));
}
```

2. `ATTACHMENT_MIME_TYPES` 扩充（追加视频/音频十项），随后：

```ts
export function isUploadableMime(mime: string): boolean {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(mime);
}
```

3. 新协议类型（新增；旧 `uploadPresignInputSchema`/`UploadPresignInput`/`UploadPresignResponse` 本任务保留、各标 `/** @deprecated removed in Task 3 */`，Task 3 随 service 重写删除——避免 T1-T3 之间 server 编译断裂）：

```ts
export interface UploadedPart {
  partNumber: number;
  size: number;
  etag: string;
}

export const uploadInitInputSchema = z.object({
  mime: z.string().min(3).max(100),
  size: z.number().int().positive(),
  filename: z.string().trim().min(1).max(255).optional(),
  resumeId: z.string().uuid().optional(),
});
export type UploadInitInput = z.infer<typeof uploadInitInputSchema>;

export interface UploadInitResponse {
  id: string;
  uploadId: string;
  partSize: number;
  totalParts: number;
  parts: UploadedPart[];
}

export interface UploadPartsResponse {
  parts: UploadedPart[];
}

export interface PartPresignResponse {
  url: string;
  expiresIn: number;
}

export interface CompletePartInput {
  partNumber: number;
  etag: string;
}

export const uploadCompletePartsInputSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(MAX_UPLOAD_PARTS),
        etag: z.string().min(1).max(128),
      }),
    )
    .min(1)
    .max(MAX_UPLOAD_PARTS),
});
export type UploadCompletePartsInput = z.infer<typeof uploadCompletePartsInputSchema>;

export interface UploadUrlResponse {
  url: string;
  expiresIn: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vital/dto test && pnpm --filter @vital/server typecheck`
Expected: dto PASS；server typecheck PASS（旧三类型保留至 Task 3，server 现有 import 不断裂）。

- [ ] **Step 5: Commit**

```bash
git add packages/dto/src/uploads.ts packages/dto/__tests__/uploads.test.ts
git commit -m "feat(dto): multipart upload protocol constants and schemas

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: storage 层 — listParts（含 ETag 与分页）

**Files:**
- Modify: `apps/server/src/storage/base.adapter.ts`
- Modify: `apps/server/src/storage/s3.adapter.ts`
- Modify: `apps/server/__tests__/helpers/storage.ts`（mock 补 listParts）
- Test: `apps/server/__tests__/storage/list-parts.test.ts`（新建，测试分页拼接/排序逻辑——通过受控 mock client，不测真 S3）

**Interfaces:**
- Consumes: Task 1 的 `UploadedPart`。
- Produces: `listParts(key: string, uploadId: string): Promise<UploadedPart[]>`（adapter 接口 + s3 实现；ETag 来自 `Part.ETag ?? ''`；分页 `NextPartNumberMarker` 拼接；按 partNumber 升序）。

- [ ] **Step 1: Write the failing test**

`apps/server/__tests__/helpers/storage.ts` 的 mock 对象在 `initMultipart` 之后加：

```ts
    listParts: vi.fn<UnifiedStorageAdapter['listParts']>().mockResolvedValue([]),
```

新建 `apps/server/__tests__/storage/list-parts.test.ts`（不 mock adapter，直接构造 S3UnifiedStorageAdapter 的实例并 stub `client.send`——先读 `s3.adapter.ts` 构造函数签名；若构造依赖 config，可 `(adapter as unknown as { client: { send: vi.Mock } }).client.send = vi.fn()` 注入）：

```ts
import { describe, expect, it, vi } from 'vitest';
import { S3UnifiedStorageAdapter } from '../../src/storage/s3.adapter.js';

function adapterWithPages(pages: Array<{ parts: Array<{ PartNumber?: number; Size?: number; ETag?: string }>; truncated: boolean; marker?: number }>) {
  const adapter = new S3UnifiedStorageAdapter({
    bucket: 'b', prefix: '', region: 'r', accessKeyId: 'a', secretAccessKey: 's', isPublic: false,
  });
  let call = 0;
  (adapter as unknown as { client: { send: ReturnType<typeof vi.fn> } }).client.send = vi.fn(async () => {
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return {
      Parts: page.parts,
      IsTruncated: page.truncated,
      NextPartNumberMarker: page.marker,
    };
  });
  return adapter;
}

describe('S3 listParts', () => {
  it('concatenates pagination, keeps order, carries etags', async () => {
    const adapter = adapterWithPages([
      { parts: [{ PartNumber: 2, Size: 5, ETag: '"e2"' }, { PartNumber: 3, Size: 5, ETag: '"e3"' }], truncated: true, marker: 3 },
      { parts: [{ PartNumber: 1, Size: 5, ETag: '"e1"' }], truncated: false },
    ]);
    const parts = await adapter.listParts('tmp/x.bin', 'up1');
    expect(parts).toEqual([
      { partNumber: 1, size: 5, etag: '"e1"' },
      { partNumber: 2, size: 5, etag: '"e2"' },
      { partNumber: 3, size: 5, etag: '"e3"' },
    ]);
    expect((adapter as unknown as { client: { send: ReturnType<typeof vi.fn> } }).client.send).toHaveBeenCalledTimes(2);
  });

  it('tolerates missing etag and size fields', async () => {
    const adapter = adapterWithPages([
      { parts: [{ PartNumber: 1, ETag: '"e1"' }], truncated: false },
    ]);
    // Size undefined → entry skipped (incomplete part info)
    expect(await adapter.listParts('k', 'u')).toEqual([]);
  });
});
```

（构造函数参数名以 `s3.adapter.ts` 实际为准——先读再写。）

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vital/server test -- storage/list-parts`
Expected: FAIL — `listParts` 不在类型上（编译错）。

- [ ] **Step 3: Implement**

`base.adapter.ts`：import `UploadedPart`（type-only）；接口与抽象类在 `presignPart` 后加 `listParts(key: string, uploadId: string): Promise<UploadedPart[]>;`。

`s3.adapter.ts`：import `ListPartsCommand`；`presignPart` 实现后加：

```ts
  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: number | undefined = undefined;
    // ListParts paginates at 1000 entries per call.
    for (;;) {
      const res = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: this.full(key),
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const p of res.Parts ?? []) {
        if (p.PartNumber === undefined || p.Size === undefined) continue;
        parts.push({ partNumber: p.PartNumber, size: p.Size, etag: p.ETag ?? '' });
      }
      if (res.IsTruncated !== true || res.NextPartNumberMarker === undefined) break;
      marker = res.NextPartNumberMarker;
    }
    parts.sort((a, b) => a.partNumber - b.partNumber);
    return parts;
  }
```

（`this.full`/`this.bucket`/`this.client` 字段名以现有 `presignPart` 实现为准。）

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @vital/server test && pnpm --filter @vital/server typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/storage/base.adapter.ts apps/server/src/storage/s3.adapter.ts apps/server/__tests__/helpers/storage.ts apps/server/__tests__/storage/list-parts.test.ts
git commit -m "feat(server): storage adapter listParts with etag and pagination

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: server uploads — multipart 四路由（service 层显式错误码），删 presign/302

**Files:**
- Modify: `apps/server/src/uploads/uploads.service.ts`
- Modify: `apps/server/src/uploads/uploads.routes.ts`
- Modify: `apps/server/src/storage/base.adapter.ts` + `s3.adapter.ts`（删 `presignPut`）
- Modify: `apps/server/__tests__/uploads.flow.test.ts`（重写）
- Modify: `apps/server/__tests__/helpers/storage.ts` + `__tests__/storage/list-parts.test.ts`（删 presignPut mock）
- Modify: `apps/server/__tests__/sweeper.test.ts`（补 uploadId 非空场景断言）

**Interfaces:**
- Consumes: Task 1 DTO、Task 2 `listParts`。
- Produces:
  - `initUpload(userId, input: UploadInitInput): Promise<UploadInitResponse>` — service 层先校验 mime（422 MEDIA_MISMATCH）与 size（413 MEDIA_TOO_LARGE），resumeId 命中（归属+status=uploading+uploadId 非空+mime/size 匹配）则复用会话并附带 ListParts 结果；不匹配 409 MEDIA_INVALID_STATE
  - `listUploadedParts(userId, id): Promise<UploadPartsResponse>`（409 若非 uploading）
  - `presignPartUpload(userId, id, partNumber): Promise<PartPresignResponse>`（越界 422 MEDIA_PART_INVALID；非 uploading 409）
  - `completeMultipartUpload(userId, id, input): Promise<UploadCompleteResponse>`（parts 覆盖 1..totalParts 无缺漏否则 422 MEDIA_PART_MISSING；completeMultipart → HEAD 校验 → ready）
  - 路由：`POST /api/v1/uploads`（201）、`GET /api/v1/uploads/:id/parts`、`POST /api/v1/uploads/:id/parts/:partNumber`、`POST /api/v1/uploads/:id/complete`、abort/bind/DELETE 不变；**删除** `POST /presign`、`GET /uploads/:id` 302、`presignUpload`/`completeUpload` service 函数

- [ ] **Step 1: 重写 flow 测试（先红）**

`apps/server/__tests__/uploads.flow.test.ts` 保留文件头基建（register/beforeEach/afterEach/mockStorage），`describe` 体替换为：

```ts
const PART = 5 * 1024 * 1024;
const SIZE_3P = 12 * 1024 * 1024; // 3 parts at 5MB

async function initUploadFor(alice: { token: string }, payload: Record<string, unknown> = {}) {
  return injectJson(app, {
    method: 'POST', url: '/api/v1/uploads', token: alice.token,
    payload: { mime: 'video/mp4', size: SIZE_3P, ...payload },
  });
}

describe('uploads (multipart)', () => {
  it('unauthenticated init is 401', async () => {
    const res = await injectJson(app, { method: 'POST', url: '/api/v1/uploads', payload: { mime: 'video/mp4', size: 1024 } });
    expect(res.statusCode).toBe(401);
  });

  it('init creates uploading row with uploadId and part math', async () => {
    const alice = await register('alice');
    const res = await initUploadFor(alice);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.uploadId).toBe('fake-upload-id');
    expect(body.partSize).toBe(PART);
    expect(body.totalParts).toBe(3);
    expect(body.parts).toEqual([]);
    const [row] = await db.select().from(attachments).where(eq(attachments.id, body.id));
    expect(row).toMatchObject({ userId: alice.id, mime: 'video/mp4', status: 'uploading', uploadId: 'fake-upload-id' });
    expect(storage.initMultipart).toHaveBeenCalledWith(row?.s3Key, { contentType: 'video/mp4' });
  });

  it('init rejects non-whitelisted mime (422) and over-5GB (413) at service level', async () => {
    const alice = await register('alice');
    const badMime = await injectJson(app, {
      method: 'POST', url: '/api/v1/uploads', token: alice.token,
      payload: { mime: 'image/svg+xml', size: 100 },
    });
    expect(badMime.statusCode).toBe(422);
    expect(badMime.json().error.code).toBe('MEDIA_MISMATCH');
    const tooBig = await injectJson(app, {
      method: 'POST', url: '/api/v1/uploads', token: alice.token,
      payload: { mime: 'video/mp4', size: 5 * 1024 ** 3 + 1 },
    });
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.json().error.code).toBe('MEDIA_TOO_LARGE');
    expect(await db.select().from(attachments)).toHaveLength(0);
  });

  it('resumeId returns the same session with uploaded parts incl etags', async () => {
    const alice = await register('alice');
    const first = await initUploadFor(alice);
    const id = first.json().id;
    storage.listParts.mockResolvedValueOnce([{ partNumber: 1, size: PART, etag: '"e1"' }]);

    const resumed = await initUploadFor(alice, { resumeId: id });
    expect(resumed.statusCode).toBe(201);
    const body = resumed.json();
    expect(body.id).toBe(id);
    expect(body.parts).toEqual([{ partNumber: 1, size: PART, etag: '"e1"' }]);
    expect(storage.initMultipart).toHaveBeenCalledTimes(1);
  });

  it('resumeId with mismatched size is 409 MEDIA_INVALID_STATE', async () => {
    const alice = await register('alice');
    const first = await initUploadFor(alice);
    const res = await initUploadFor(alice, { size: 20 * 1024 * 1024, resumeId: first.json().id });
    expect(res.statusCode).toBe(409);
  });

  it('presign part validates range and ownership', async () => {
    const alice = await register('alice');
    const bob = await register('bob');
    const { id } = (await initUploadFor(alice)).json();

    const ok = await injectJson(app, { method: 'POST', url: `/api/v1/uploads/${id}/parts/2`, token: alice.token, payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().url).toBe('https://fake.local/presigned-part');
    expect(storage.presignPart).toHaveBeenCalledWith(expect.any(String), 'fake-upload-id', 2, expect.any(Number));

    const outOfRange = await injectJson(app, { method: 'POST', url: `/api/v1/uploads/${id}/parts/99`, token: alice.token, payload: {} });
    expect(outOfRange.statusCode).toBe(422);
    expect(outOfRange.json().error.code).toBe('MEDIA_PART_INVALID');

    const foreign = await injectJson(app, { method: 'POST', url: `/api/v1/uploads/${id}/parts/1`, token: bob.token, payload: {} });
    expect(foreign.statusCode).toBe(404);
  });

  it('GET /uploads/:id/parts lists uploaded parts for the owner', async () => {
    const alice = await register('alice');
    const { id } = (await initUploadFor(alice)).json();
    storage.listParts.mockResolvedValueOnce([
      { partNumber: 1, size: PART, etag: '"e1"' },
      { partNumber: 2, size: PART, etag: '"e2"' },
    ]);
    const res = await injectJson(app, { method: 'GET', url: `/api/v1/uploads/${id}/parts`, token: alice.token });
    expect(res.statusCode).toBe(200);
    expect(res.json().parts).toHaveLength(2);
  });

  it('complete with missing parts is 422 MEDIA_PART_MISSING; full set marks ready', async () => {
    const alice = await register('alice');
    const init = await initUploadFor(alice);
    const { id, totalParts } = init.json();

    const missing = await injectJson(app, {
      method: 'POST', url: `/api/v1/uploads/${id}/complete`, token: alice.token,
      payload: { parts: [{ partNumber: 1, etag: '"e1"' }] },
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.code).toBe('MEDIA_PART_MISSING');

    storage.headObject.mockResolvedValueOnce({ size: SIZE_3P, contentType: 'video/mp4', lastModified: new Date() });
    const full = await injectJson(app, {
      method: 'POST', url: `/api/v1/uploads/${id}/complete`, token: alice.token,
      payload: { parts: Array.from({ length: totalParts }, (_, i) => ({ partNumber: i + 1, etag: `"e${i + 1}"` })) },
    });
    expect(full.statusCode).toBe(200);
    expect(full.json()).toMatchObject({ id, status: 'ready', mime: 'video/mp4' });
    expect(storage.completeMultipart).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(row?.status).toBe('ready');
  });

  it('HEAD mismatch on complete is 422 MEDIA_MISMATCH', async () => {
    const alice = await register('alice');
    const { id, totalParts } = (await initUploadFor(alice)).json();
    storage.headObject.mockResolvedValueOnce({ size: 999, contentType: 'video/mp4', lastModified: new Date() });
    const res = await injectJson(app, {
      method: 'POST', url: `/api/v1/uploads/${id}/complete`, token: alice.token,
      payload: { parts: Array.from({ length: totalParts }, (_, i) => ({ partNumber: i + 1, etag: `"e${i + 1}"` })) },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('MEDIA_MISMATCH');
  });

  it('abort calls abortMultipart and orphans the row', async () => {
    const alice = await register('alice');
    const { id } = (await initUploadFor(alice)).json();
    const res = await injectJson(app, { method: 'POST', url: `/api/v1/uploads/${id}/abort`, token: alice.token, payload: {} });
    expect(res.statusCode).toBe(204);
    expect(storage.abortMultipart).toHaveBeenCalledWith(expect.any(String), 'fake-upload-id');
    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    expect(row?.status).toBe('orphaned');
  });

  it('old presign and 302 GET routes are gone', async () => {
    const alice = await register('alice');
    const presign = await injectJson(app, {
      method: 'POST', url: '/api/v1/uploads/presign', token: alice.token, payload: { mime: 'image/jpeg', size: 10 },
    });
    expect(presign.statusCode).toBe(404);
    const redirect = await injectJson(app, {
      method: 'GET', url: '/api/v1/uploads/00000000-0000-4000-8000-000000000000', token: alice.token,
    });
    expect(redirect.statusCode).toBe(404);
  });
});
```

注意：`GET` 调用不传 `payload`（helper 只在有 payload 时带上）。`register` 沿用文件现有实现。

`apps/server/__tests__/sweeper.test.ts` 追加一条（uploadId 非空走 abortMultipart——现有测试可能只测 null uploadId，先读文件再追加，风格一致）：

```ts
it('stale uploading with uploadId aborts the multipart session', async () => {
  // insert attachments row: status 'uploading', uploadId 'fake-upload-id',
  // createdAt older than MEDIA_UPLOADING_TTL_HOURS — 照抄现有 stale 用例的 insert 模式
  // run sweep → expect storage.abortMultipart toHaveBeenCalledWith(key, 'fake-upload-id')
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vital/server test -- uploads.flow`
Expected: FAIL — 新路由 404。

- [ ] **Step 3: Implement**

`uploads.service.ts`：

1. imports：加 `MAX_UPLOAD_BYTES, isUploadableMime, partSizeFor, totalPartsFor, type UploadInitInput, type UploadInitResponse, type UploadPartsResponse, type PartPresignResponse, type UploadCompletePartsInput`；删 `UploadPresignInput/UploadPresignResponse/MAX_IMAGE_BYTES`。
2. 删 `presignUpload`/`completeUpload`，新增（完整实现，错误码全部 service 层显式）：

```ts
export async function initUpload(userId: string, input: UploadInitInput): Promise<UploadInitResponse> {
  if (!isUploadableMime(input.mime)) {
    throw AppError.of(422, 'MEDIA_MISMATCH');
  }
  if (input.size > MAX_UPLOAD_BYTES) {
    throw AppError.of(413, 'MEDIA_TOO_LARGE');
  }
  const partSize = partSizeFor(input.size);
  const totalParts = totalPartsFor(input.size);

  if (input.resumeId !== undefined) {
    const [row] = await getDb().select().from(attachments).where(eq(attachments.id, input.resumeId)).limit(1);
    if (
      row &&
      row.userId === userId &&
      row.status === 'uploading' &&
      row.uploadId !== null &&
      row.mime === input.mime &&
      row.size === input.size
    ) {
      const parts = await getStorage().listParts(row.s3Key, row.uploadId);
      return { id: row.id, uploadId: row.uploadId, partSize, totalParts, parts };
    }
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }

  const id = randomUUID();
  const ext = mime.extension(input.mime) || 'bin';
  const tmpKey = `tmp/${id}.${ext}`;
  const uploadId = await getStorage().initMultipart(tmpKey, { contentType: input.mime });
  await getDb().insert(attachments).values({
    id, userId, ownerType: 'tmp', ownerId: null, s3Key: tmpKey,
    mime: input.mime, size: input.size, status: 'uploading',
    storageMeta: currentStorageMeta(), uploadId, sortOrder: 0,
  });
  return { id, uploadId, partSize, totalParts, parts: [] };
}

export async function listUploadedParts(userId: string, id: string): Promise<UploadPartsResponse> {
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status !== 'uploading' || row.uploadId === null) {
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }
  return { parts: await getStorage().listParts(row.s3Key, row.uploadId) };
}

export async function presignPartUpload(
  userId: string, id: string, partNumber: number,
): Promise<PartPresignResponse> {
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status !== 'uploading' || row.uploadId === null) {
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalPartsFor(row.size)) {
    throw AppError.of(422, 'MEDIA_PART_INVALID');
  }
  const url = await getStorage().presignPart(row.s3Key, row.uploadId, partNumber, config.PRESIGN_PUT_TTL_SECONDS);
  return { url, expiresIn: config.PRESIGN_PUT_TTL_SECONDS };
}

export async function completeMultipartUpload(
  userId: string, id: string, input: UploadCompletePartsInput,
): Promise<UploadCompleteResponse> {
  const started = Date.now();
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status === 'ready') {
    return { id: row.id, status: 'ready', mime: row.mime, size: row.size, ownerType: 'tmp' };
  }
  if (row.status !== 'uploading' || row.uploadId === null) {
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }
  const totalParts = totalPartsFor(row.size);
  const seen = new Set(input.parts.map((p) => p.partNumber));
  for (let n = 1; n <= totalParts; n += 1) {
    if (!seen.has(n)) throw AppError.of(422, 'MEDIA_PART_MISSING');
  }
  await getStorage().completeMultipart(
    row.s3Key, row.uploadId,
    input.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
  );
  const head = await getStorage().headObject(row.s3Key);
  if (!head || head.size !== row.size || head.contentType !== row.mime) {
    throw AppError.of(422, 'MEDIA_MISMATCH');
  }
  const updated = await getDb()
    .update(attachments)
    .set({ status: 'ready' })
    .where(and(eq(attachments.id, id), eq(attachments.status, 'uploading')))
    .returning({ id: attachments.id });
  if (updated.length === 0) {
    const [now] = await getDb().select().from(attachments).where(eq(attachments.id, id)).limit(1);
    if (now?.status === 'ready') {
      return { id: row.id, status: 'ready', mime: row.mime, size: row.size, ownerType: 'tmp' };
    }
    throw AppError.of(409, 'MEDIA_INVALID_STATE');
  }
  logger.info('upload_complete_ms', { id, ms: Date.now() - started });
  return { id: row.id, status: 'ready', mime: row.mime, size: row.size, ownerType: 'tmp' };
}
```

3. `uploads.routes.ts`：删 presign/302 路由，新增（schema 用 Task 1 的；partNumber 用 `z.coerce.number().int().positive()`）：

```ts
app.post('/api/v1/uploads', { preHandler: [requireAuth] }, async (req, reply) => {
  const user = req.user; if (!user) throw AppError.of(401, 'INVALID_TOKEN');
  const result = await initUpload(user.id, uploadInitInputSchema.parse(req.body));
  return reply.code(201).send(result);
});
app.get('/api/v1/uploads/:id/parts', { preHandler: [requireAuth] }, async (req) => {
  const user = req.user; if (!user) throw AppError.of(401, 'INVALID_TOKEN');
  const { id } = idParams.parse(req.params);
  return listUploadedParts(user.id, id);
});
app.post('/api/v1/uploads/:id/parts/:partNumber', { preHandler: [requireAuth] }, async (req) => {
  const user = req.user; if (!user) throw AppError.of(401, 'INVALID_TOKEN');
  const { id, partNumber } = partParams.parse(req.params);
  return presignPartUpload(user.id, id, partNumber);
});
// complete 路由的 body 换 uploadCompletePartsInputSchema.parse(req.body)
```

4. `base.adapter.ts`/`s3.adapter.ts`/两个测试 helper：删 `presignPut`（接口、抽象、实现、mock 项、list-parts.test 的 base 对象）。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @vital/server test && pnpm --filter @vital/server typecheck`
Expected: PASS（sweeper 追加用例绿）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/uploads/uploads.service.ts apps/server/src/uploads/uploads.routes.ts apps/server/src/storage/base.adapter.ts apps/server/src/storage/s3.adapter.ts apps/server/__tests__/uploads.flow.test.ts apps/server/__tests__/helpers/storage.ts apps/server/__tests__/storage/list-parts.test.ts apps/server/__tests__/sweeper.test.ts
git commit -m "feat(server): multipart upload routes with resume; drop presign and 302

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: server inbox — InboxAsset.mime 下发（DTO + service 同任务落地）

**Files:**
- Modify: `packages/dto/src/inbox.ts`（`InboxAsset` 加 `mime: string`——本任务与 service 同提交，无暂红窗口）
- Modify: `apps/server/src/inbox/inbox.service.ts`（`toAssetDto` 返回 mime）
- Test: `apps/server/__tests__/inbox/asset-mime.test.ts`（新建）

**Interfaces:**
- Consumes: 无新依赖。
- Produces: inbox API 的每个 asset 含 `mime`（如 `application/pdf`）。

- [ ] **Step 1: Write the failing test**

新建 `apps/server/__tests__/inbox/asset-mime.test.ts`（**必须 `installMockStorage()`**——`toAssetDto` 调 `getStorage().generateAccessUrl`，无 mock 会构造真 S3 adapter）：

```ts
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { attachments, inboxAssets, inboxItems, users } from '../../src/db/schema.js';
import { loadAssetsByItemIds } from '../../src/inbox/inbox.service.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});
beforeEach(async () => {
  await resetDb();
  installMockStorage();
});
afterEach(() => {
  setStorageAdapter(null);
});
afterAll(async () => {
  await app.close();
});

describe('inbox asset mime', () => {
  it('loadAssetsByItemIds returns attachment mime', async () => {
    const [user] = await db.insert(users).values({
      email: `asset-mime-${Date.now()}@test.com`, passwordHash: 'x', displayName: 't',
    }).returning();
    expect(user).toBeDefined();
    const userId = user!.id;
    const attachmentId = '22222222-2222-4222-8222-222222222222';
    const itemId = '33333333-3333-4333-8333-333333333333';
    await db.insert(attachments).values({
      id: attachmentId, userId, ownerType: 'tmp', s3Key: 'tmp/x.pdf',
      mime: 'application/pdf', size: 100, status: 'ready', storageMeta: {},
    });
    await db.insert(inboxItems).values({
      id: itemId, userId, title: 'pdf item', status: 'unread', source: 'extension',
    });
    await db.insert(inboxAssets).values({
      inboxItemId: itemId, attachmentId, originalSrc: 'https://ex.com/a.pdf', sortOrder: 0,
    });

    const map = await loadAssetsByItemIds([itemId]);
    expect(map.get(itemId)).toHaveLength(1);
    expect(map.get(itemId)?.[0]).toMatchObject({ mime: 'application/pdf', attachmentId });
  });
});
```

（`users`/`inboxItems`/`inboxAssets` 的必填列以 schema 实际为准——先读 `apps/server/src/db/schema/users.ts` 和 `inbox.ts`；`source` 枚举在 6334a0a 后含 `wechat`，用 `'extension'` 安全。）

**rev3 修订**：3. 新协议类型段落措辞统一为——旧 `uploadPresignInputSchema`/`UploadPresignInput`/`UploadPresignResponse` **保留不删**（标 `/** @deprecated removed in Task 3 */` 注释），Task 3 随 service 重写一并删除。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vital/server test -- inbox/asset-mime`
Expected: FAIL — TS 编译错（InboxAsset 无 mime 字段，DTO 还没加）。

- [ ] **Step 3: Implement**

`packages/dto/src/inbox.ts`：`InboxAsset` interface 加 `mime: string;`（`url` 之前）。

`apps/server/src/inbox/inbox.service.ts`：

1. `toAssetDto` 参数类型加 `mime: string;`，返回对象加 `mime: row.mime,`。
2. `loadAssetsByItemIds` 传给 `toAssetDto` 的字面量补 `mime: row.attachments.mime,`。
3. grep 同文件其他 `InboxAsset` 构造点（`grep -n "originalSrc:" inbox.service.ts`）同步补。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @vital/server test && pnpm --filter @vital/server typecheck && pnpm --filter @vital/web test`
Expected: PASS（web 若有 InboxAsset fixture 缺 mime 的类型错——vitest 不查类型，typecheck 由 server 侧保证；web typecheck 在 T7/T9 跑）。

- [ ] **Step 5: Commit**

```bash
git add packages/dto/src/inbox.ts apps/server/src/inbox/inbox.service.ts apps/server/__tests__/inbox/asset-mime.test.ts
git commit -m "feat(server): expose asset mime in inbox API for reader rendering

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: api-client — upload() 分片重写（注入 fetch、resume 409 回退、partSource）

**Files:**
- Modify: `packages/api-client/src/upload.ts`（重写；`UploadInput` 定义于此并从 index 导出）
- Modify: `packages/api-client/src/client.ts`（删 `uploadUrl`/`putWithProgress` 透传；upload 调用新签名）
- Modify: `packages/api-client/src/types.ts`（删 `PutFn`/`putWithProgress`/`FilePart`）
- Modify: `packages/api-client/src/index.ts`（导出清理）
- Delete: `packages/api-client/src/default-put.ts`、`packages/api-client/__tests__/default-put.test.ts`
- Modify: `packages/api-client/__tests__/upload.test.ts`（重写）+ `__tests__/client.test.ts`（旧 presign/uploadUrl 断言更新——先读 155-164 行附近）
- Modify: `apps/web/src/api/client.ts`（删 `PutFn`/`barePutInit` import 与 `tauriPut`/`putWithProgress` 透传；S3 PUT 走注入的 `fetchImpl`）
- Modify: `apps/extension/src/client.ts`（删 `putWithProgress: fetchPut` 行）
- Modify: `apps/mobile/src/lib/api.ts` + `apps/mobile/src/lib/rn-put.ts`（删 `putWithProgress: rnPut`；rn-put 的 `PutFn`/`FilePart` import 删除——rn-put 整个文件若仅为此存在则删除；mobile 的正确 partSource 在 Task 8 接）

**Interfaces:**
- Consumes: Task 1 DTO、Task 3 路由。
- Produces:
  - `UploadInput { file?: Blob; partSource?: (start: number, end: number) => Promise<Blob>; mime: string; size: number; onProgress?: (loaded: number, total: number) => void; onAttachmentId?: (id: string) => void; signal?: AbortSignal; resumeId?: string }`（**fileUri 形态删除**；file 与 partSource 二选一）
  - `upload(input: UploadInput): Promise<UploadCompleteResponse>`：init（resumeId 409 时自动去 resumeId 重试一次）→ 跳过 init.parts 已传片 → 逐片 presign + PUT（**走注入的 `options.fetchImpl ?? fetch`**）→ complete（全量 ETag：本轮上传的 + init.parts 携带的）
  - 跳片时 onProgress 基数累加已传片 size（进度不从中间跳）

- [ ] **Step 1: 重写测试（先红）**

`packages/api-client/__tests__/upload.test.ts` 重写：

```ts
import { describe, expect, it } from 'vitest';
import { createVitalClient, ApiError, type TokenStore } from '../src/index.js';
import { bodyOf, respond, urlOf } from './test-helpers.js';

const tokenStore: TokenStore = {
  getAccessToken: () => 'a', getRefreshToken: () => 'r', setTokens: () => undefined, clear: () => undefined,
};

const PART = 5 * 1024 * 1024;

function s3Put(etag: string): Response {
  return new Response(null, { status: 200, headers: { ETag: etag } });
}

function makeClient(fetchImpl: typeof fetch) {
  return createVitalClient({ baseUrl: '', authMode: 'bearer', tokenStore, fetchImpl });
}

describe('upload (multipart)', () => {
  it('init → presign each part → PUT via injected fetch → complete with etags', async () => {
    const apiCalls: string[] = [];
    let s3PutCount = 0;
    const blob = new Blob([new Uint8Array(PART + 100)]); // 2 parts
    const client = makeClient((url, init) => {
      const u = urlOf(url);
      if (u.startsWith('https://s3')) {
        s3PutCount += 1;
        expect(init?.method).toBe('PUT');
        expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
        return Promise.resolve(s3Put(`"e${s3PutCount}"`));
      }
      apiCalls.push(`${init?.method ?? 'GET'} ${u}`);
      if (u === '/api/v1/uploads') {
        expect(bodyOf(init)).toMatchObject({ mime: 'application/pdf', size: blob.size });
        return respond(201, { id: 'att1', uploadId: 'up1', partSize: PART, totalParts: 2, parts: [] });
      }
      if (u === '/api/v1/uploads/att1/parts/1' || u === '/api/v1/uploads/att1/parts/2') {
        return respond(200, { url: `https://s3${u}`, expiresIn: 900 });
      }
      if (u === '/api/v1/uploads/att1/complete') {
        const body = bodyOf(init) as { parts: Array<{ partNumber: number; etag: string }> };
        expect(body.parts).toEqual([
          { partNumber: 1, etag: '"e1"' },
          { partNumber: 2, etag: '"e2"' },
        ]);
        return respond(200, { id: 'att1', status: 'ready', mime: 'application/pdf', size: blob.size, ownerType: 'tmp' });
      }
      return respond(200, {});
    });
    const res = await client.upload({ file: blob, mime: 'application/pdf', size: blob.size });
    expect(res.status).toBe('ready');
    expect(s3PutCount).toBe(2);
    expect(apiCalls).toEqual([
      'POST /api/v1/uploads',
      'POST /api/v1/uploads/att1/parts/1',
      'POST /api/v1/uploads/att1/parts/2',
      'POST /api/v1/uploads/att1/complete',
    ]);
  });

  it('resume skips uploaded parts and keeps their etags for complete', async () => {
    const blob = new Blob([new Uint8Array(PART + 100)]);
    const putPartNumbers: number[] = [];
    const progress: Array<[number, number]> = [];
    const client = makeClient((url, init) => {
      const u = urlOf(url);
      if (u.startsWith('https://s3')) {
        putPartNumbers.push(2);
        return Promise.resolve(s3Put('"e2"'));
      }
      if (u === '/api/v1/uploads') {
        expect(bodyOf(init)).toMatchObject({ resumeId: 'att1' });
        return respond(201, {
          id: 'att1', uploadId: 'up1', partSize: PART, totalParts: 2,
          parts: [{ partNumber: 1, size: PART, etag: '"e1"' }],
        });
      }
      if (u === '/api/v1/uploads/att1/parts/2') {
        return respond(200, { url: 'https://s3/2', expiresIn: 900 });
      }
      if (u === '/api/v1/uploads/att1/complete') {
        const body = bodyOf(init) as { parts: Array<{ partNumber: number; etag: string }> };
        expect(body.parts).toEqual([
          { partNumber: 1, etag: '"e1"' }, // carried from init.parts
          { partNumber: 2, etag: '"e2"' },
        ]);
        return respond(200, { id: 'att1', status: 'ready', mime: 'application/pdf', size: blob.size, ownerType: 'tmp' });
      }
      return respond(200, {});
    });
    const res = await client.upload({
      file: blob, mime: 'application/pdf', size: blob.size, resumeId: 'att1',
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });
    expect(res.status).toBe('ready');
    expect(putPartNumbers).toEqual([2]); // part 1 skipped
    // progress starts from the resumed base, not 0
    expect(progress[0]?.[0]).toBe(PART);
  });

  it('resume 409 falls back to a fresh init without resumeId', async () => {
    const blob = new Blob([new Uint8Array(10)]);
    let initCalls = 0;
    const client = makeClient((url, init) => {
      const u = urlOf(url);
      if (u === '/api/v1/uploads') {
        initCalls += 1;
        const body = bodyOf(init) as { resumeId?: string };
        if (initCalls === 1) {
          expect(body.resumeId).toBe('att-old');
          return respond(409, { error: { code: 'MEDIA_INVALID_STATE' } });
        }
        expect(body.resumeId).toBeUndefined();
        return respond(201, { id: 'att1', uploadId: 'up1', partSize: PART, totalParts: 1, parts: [] });
      }
      if (u === '/api/v1/uploads/att1/parts/1') return respond(200, { url: 'https://s3/1', expiresIn: 900 });
      if (u === '/api/v1/uploads/att1/complete') {
        return respond(200, { id: 'att1', status: 'ready', mime: 'application/pdf', size: blob.size, ownerType: 'tmp' });
      }
      if (u.startsWith('https://s3')) return Promise.resolve(s3Put('"e1"'));
      return respond(200, {});
    });
    const res = await client.upload({ file: blob, mime: 'application/pdf', size: blob.size, resumeId: 'att-old' });
    expect(res.status).toBe('ready');
    expect(initCalls).toBe(2);
  });

  it('partSource is used instead of file slicing', async () => {
    const requested: Array<[number, number]> = [];
    const blob = new Blob([new Uint8Array(PART + 100)]);
    const client = makeClient((url) => {
      const u = urlOf(url);
      if (u === '/api/v1/uploads') {
        return respond(201, { id: 'att1', uploadId: 'up1', partSize: PART, totalParts: 2, parts: [] });
      }
      if (u.endsWith('/parts/1') || u.endsWith('/parts/2')) {
        return respond(200, { url: `https://s3${u}`, expiresIn: 900 });
      }
      if (u.endsWith('/complete')) {
        return respond(200, { id: 'att1', status: 'ready', mime: 'application/pdf', size: blob.size, ownerType: 'tmp' });
      }
      if (u.startsWith('https://s3')) return Promise.resolve(s3Put('"e"'));
      return respond(200, {});
    });
    await client.upload({
      mime: 'application/pdf', size: blob.size,
      partSource: async (start, end) => {
        requested.push([start, end]);
        return blob.slice(start, end);
      },
    });
    expect(requested).toEqual([[0, PART], [PART, PART + 100]]);
  });

  it('presigned PUT failure surfaces as ApiError and never completes', async () => {
    const blob = new Blob([new Uint8Array(10)]);
    let completed = false;
    const client = makeClient((url) => {
      const u = urlOf(url);
      if (u === '/api/v1/uploads') return respond(201, { id: 'att1', uploadId: 'up1', partSize: PART, totalParts: 1, parts: [] });
      if (u.endsWith('/parts/1')) return respond(200, { url: 'https://s3/1', expiresIn: 900 });
      if (u.endsWith('/complete')) { completed = true; return respond(200, {}); }
      if (u.startsWith('https://s3')) return Promise.resolve(new Response(null, { status: 403 }));
      return respond(200, {});
    });
    await expect(
      client.upload({ file: blob, mime: 'application/pdf', size: blob.size }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(completed).toBe(false);
  });

  it('over 5GB fails client-side with 413 before any request', async () => {
    const client = makeClient(() => respond(200, {}));
    await expect(
      client.upload({ file: new Blob(), mime: 'video/mp4', size: 5 * 1024 ** 3 + 1 }),
    ).rejects.toMatchObject({ status: 413 });
  });
});
```

同时读 `packages/api-client/__tests__/client.test.ts` 中引用 `presign`/`uploadUrl`/`complete` 的用例并更新为新协议（mock 数据改为 multipart 形状）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vital/api-client test`
Expected: FAIL。

- [ ] **Step 3: Implement**

`packages/api-client/src/upload.ts` 重写（完整实现）：

```ts
import {
  ERROR_MESSAGES,
  MAX_UPLOAD_BYTES,
  isUploadableMime,
  type UploadCompleteResponse,
  type UploadInitResponse,
} from '@vital/dto';
import type { Http } from './http.js';
import { ApiError, type VitalClientOptions } from './types.js';

export interface UploadInput {
  /** Whole-file blob (web/extension, small files). */
  file?: Blob;
  /** Lazy part fetcher (streaming/5GB). Called with ascending [start, end). */
  partSource?: (start: number, end: number) => Promise<Blob>;
  mime: string;
  size: number;
  onProgress?: (loaded: number, total: number) => void;
  onAttachmentId?: (id: string) => void;
  signal?: AbortSignal;
  /** Resume a previous multipart session; uploaded parts are skipped. */
  resumeId?: string;
}

async function initSession(
  http: Http,
  input: UploadInput,
  withResume: boolean,
): Promise<UploadInitResponse> {
  return http.request<UploadInitResponse>('/api/v1/uploads', {
    method: 'POST',
    body: {
      mime: input.mime,
      size: input.size,
      ...(withResume && input.resumeId !== undefined ? { resumeId: input.resumeId } : {}),
    },
  });
}

export async function uploadImpl(
  http: Http,
  options: VitalClientOptions,
  input: UploadInput,
): Promise<UploadCompleteResponse> {
  if (input.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, 'MEDIA_TOO_LARGE', ERROR_MESSAGES.MEDIA_TOO_LARGE);
  }
  if (!isUploadableMime(input.mime)) {
    throw new ApiError(422, 'MEDIA_MISMATCH', ERROR_MESSAGES.MEDIA_MISMATCH);
  }
  if (input.file === undefined && input.partSource === undefined) {
    throw new ApiError(0, 'UPLOAD_INPUT_INVALID', 'file 与 partSource 必须提供其一');
  }

  let init: UploadInitResponse;
  try {
    init = await initSession(http, input, true);
  } catch (err) {
    // Stale/mismatched resume session → fall back to a fresh one (spec ⑤).
    if (input.resumeId !== undefined && err instanceof ApiError && err.status === 409) {
      init = await initSession(http, input, false);
    } else {
      throw err;
    }
  }
  input.onAttachmentId?.(init.id);

  const etags = new Map<number, string>();
  let loaded = 0;
  for (const p of init.parts) {
    etags.set(p.partNumber, p.etag);
    loaded += p.size; // resumed base so progress does not restart from 0
  }
  input.onProgress?.(loaded, input.size);

  for (let n = 1; n <= init.totalParts; n += 1) {
    if (etags.has(n)) continue;
    const start = (n - 1) * init.partSize;
    const end = Math.min(n * init.partSize, input.size);
    const presigned = await http.request<{ url: string }>(
      `/api/v1/uploads/${init.id}/parts/${n}`,
      { method: 'POST', body: {} },
    );
    const body = input.partSource !== undefined
      ? await input.partSource(start, end)
      : input.file!.slice(start, end);
    const res = await (options.fetchImpl ?? fetch)(presigned.url, {
      method: 'PUT',
      headers: { 'Content-Type': input.mime },
      body,
      credentials: 'omit',
      signal: input.signal,
    });
    if (!res.ok) {
      throw new ApiError(res.status, 'UPLOAD_FAILED', `直传失败（${String(res.status)}）`);
    }
    const etag = res.headers.get('ETag');
    if (etag === null || etag === '') {
      throw new ApiError(0, 'UPLOAD_ETAG_MISSING', 'S3 未返回 ETag');
    }
    etags.set(n, etag);
    loaded = end;
    input.onProgress?.(loaded, input.size);
  }

  const parts: Array<{ partNumber: number; etag: string }> = [];
  for (let n = 1; n <= init.totalParts; n += 1) {
    const etag = etags.get(n);
    if (etag === undefined) {
      throw new ApiError(0, 'UPLOAD_ETAG_MISSING', `分片 ${n} 缺少 ETag`);
    }
    parts.push({ partNumber: n, etag });
  }
  return http.request<UploadCompleteResponse>(`/api/v1/uploads/${init.id}/complete`, {
    method: 'POST',
    body: { parts },
  });
}
```

（`ApiError` 的 status 字段名以 `types.ts` 实际为准——先读；旧 `xhrPut` 里是 `new ApiError(403, ...)` 两参 + message 第三参，照抄其构造签名。）

其余文件：

- `types.ts`：删 `PutFn`/`putWithProgress`/`FilePart`（grep `FilePart` 全仓确认仅 default-put/upload 用）。
- `client.ts`：接口删 `uploadUrl`；`upload: (input) => uploadImpl(http, options, input)`；删 putWithProgress 透传。
- `index.ts`：删 default-put 导出（`bareGetInit` 若有别处引用——grep 后决定：被引用则把该函数挪进 `upload.ts` 导出）。
- 删 `default-put.ts`、`default-put.test.ts`。
- `apps/web/src/api/client.ts`：删 `PutFn`/`barePutInit`/`tauriPut` 相关（Tauri 的 S3 PUT 由 `tauriFetch` 注入的 fetchImpl 覆盖——`uploadImpl` 用 `options.fetchImpl ?? fetch`，web 的 tauriFetch 已注入，无需单独 put 路径）；确认 `putWithProgress` 透传行删除。
- `apps/extension/src/client.ts`：删 `putWithProgress: fetchPut` 行 + `fetchPut` import。
- `apps/mobile/src/lib/api.ts`：删 `putWithProgress: rnPut`；`rn-put.ts` 若仅剩 PutFn 用途则删除（grep 确认），否则最小修补。**mobile 的 avatar 上传此刻会缺 partSource/file** —— Task 8 接 `file: new File(uri)`（expo 新 API File implements Blob）。**为避免 mobile 中间态不可用**，本任务在 `apps/mobile/src/lib/api.ts` 的 createVitalClient 调用处加注入（若 api.ts 有统一工厂）或直接改 `SettingsHome.tsx` 传 `file: new File(asset.uri)`——**按最小改动：api.ts 的 client 工厂无法预置 per-call input，故在 SettingsHome.tsx 的 pickAvatar 里 `client.upload({ file: new File(asset.uri), mime, size })`**（expo-file-system 新 File 类 implements Blob、支持 slice——已验证 v19.0.24）。该改动小且立即生效，列入本任务 Files。
- `packages/api-client/__tests__/client.test.ts`：旧断言按新协议改。

- [ ] **Step 4: Run tests（全仓受影响包）**

```bash
pnpm --filter @vital/api-client test && pnpm --filter @vital/api-client typecheck \
&& pnpm --filter @vital/extension typecheck && pnpm --filter @vital/web test \
&& pnpm --filter @vital/web exec tsc --noEmit && pnpm --filter @vital/server typecheck
```

Expected: PASS（web typecheck 覆盖 `apps/web/src/api/client.ts` 的 import 清理）。

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/upload.ts packages/api-client/src/client.ts packages/api-client/src/types.ts packages/api-client/src/index.ts packages/api-client/__tests__/upload.test.ts packages/api-client/__tests__/client.test.ts apps/web/src/api/client.ts apps/extension/src/client.ts apps/mobile/src/lib/api.ts apps/mobile/src/lib/rn-put.ts apps/mobile/src/features/settings/SettingsHome.tsx
git rm packages/api-client/src/default-put.ts packages/api-client/__tests__/default-put.test.ts
git commit -m "feat(api-client): multipart upload with resume via injected fetch; drop PUT track

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

（rn-put.ts 若删除则 git rm；若 mobile/extension 的文件在本任务无改动则不 add。）

---

### Task 6: 扩展 — file-kind 识别 + 流式转存（字节对齐 partSource）+ popup file 模式

**Files:**
- Create: `apps/extension/src/file-kind.ts`
- Create: `apps/extension/__tests__/file-kind.test.ts`
- Create: `apps/extension/src/stream-rehost.ts`（流式 partSource，字节对齐——单测核心）
- Create: `apps/extension/__tests__/stream-rehost.test.ts`
- Modify: `apps/extension/src/capture.ts`、`src/messages.ts`、`src/popup-state.ts`、`src/i18n.ts`、`entrypoints/popup/main.ts`
- Test: `apps/extension/__tests__/popup-state.test.ts`（initialMode 签名更新 + file 模式）

**Interfaces:**
- Consumes: Task 1 `MAX_UPLOAD_BYTES`/`isUploadableMime`、Task 5 `upload({partSource, resumeId})`。
- Produces:
  - `fileKindOf(url): 'pdf' | 'video' | 'audio' | null`
  - `fileModeFromResponse(url, contentType, contentLength): { url; mime; size } | null`（**未知长度一律 null**——协议 size 必须正数；MIME 收紧为 pdf/video/audio 三类，image/* 不算文件模式）
  - `createStreamPartSource(stream: ReadableStream<Uint8Array>): StreamPartSource`（`StreamPartSource = { partSource: (start: number, end: number) => Promise<Blob> }`）— **字节对齐**：内部 reader 跟踪 `consumed` 字节；请求的 `start > consumed` 时先丢弃 `start - consumed` 字节再取；`start < consumed`（不应发生）抛 `UPLOAD_STREAM_REWIND`；流提前结束抛 `UPLOAD_STREAM_SHORT`
  - `PopupMode` 加 `'file'`；`CapturePayload` 加 `file: { url: string; mime: string; size: number } | null`
  - `initialMode(capture: CapturePayload): PopupMode` — file 优先，其次 selection，再次 article
  - `commitCapture` file 分支：createExtensionItem → 流式 rehost（resume：`chrome.storage.session` key `vital.rehost.<sha256(canonicalUrl)>` 存 `{ attachmentId, size, mime }`）→ patchInboxAssets

- [ ] **Step 1: file-kind + stream-rehost 测试（先红）**

`apps/extension/__tests__/file-kind.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { fileKindOf, fileModeFromResponse } from '../src/file-kind.js';

describe('fileKindOf', () => {
  it('maps direct-link extensions', () => {
    expect(fileKindOf('https://ex.com/a/report.pdf')).toBe('pdf');
    expect(fileKindOf('https://ex.com/v/clip.mp4?t=3')).toBe('video');
    expect(fileKindOf('https://ex.com/v/clip.MOV')).toBe('video');
    expect(fileKindOf('https://ex.com/a/song.flac')).toBe('audio');
    expect(fileKindOf('https://ex.com/a/page.html')).toBeNull();
    expect(fileKindOf('https://ex.com/a.png')).toBeNull(); // images stay article-mode
  });
});

describe('fileModeFromResponse', () => {
  it('accepts pdf/video/audio mime with known size within 5GB', () => {
    expect(fileModeFromResponse('https://ex.com/a.pdf', 'application/pdf', 123)).toEqual({
      url: 'https://ex.com/a.pdf', mime: 'application/pdf', size: 123,
    });
    expect(fileModeFromResponse('https://ex.com/a.mp4', 'video/mp4; charset=binary', 500)).toEqual({
      url: 'https://ex.com/a.mp4', mime: 'video/mp4', size: 500,
    });
  });

  it('rejects html, images, unknown mime, unknown length, and oversized', () => {
    expect(fileModeFromResponse('https://ex.com/a', 'text/html', 100)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a.jpg', 'image/jpeg', 100)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a', 'application/x-msdownload', 100)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a.pdf', 'application/pdf', null)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a.mp4', 'video/mp4', 5 * 1024 ** 3 + 1)).toBeNull();
  });
});
```

`apps/extension/__tests__/stream-rehost.test.ts`（**核心：resume 跳片的字节对齐**）：

```ts
import { describe, expect, it } from 'vitest';
import { createStreamPartSource } from '../src/stream-rehost.js';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe('createStreamPartSource', () => {
  it('sequential slices consume the stream in order', async () => {
    const blob = new Blob(['aaaabbbbcccc']);
    const src = createStreamPartSourceFromBlob(blob);
    expect(await (await src.partSource(0, 4)).text()).toBe('aaaa');
    expect(await (await src.partSource(4, 8)).text()).toBe('bbbb');
    expect(await (await src.partSource(8, 12)).text()).toBe('cccc');
  });

  it('resume skip: discards bytes up to start before reading the part', async () => {
    // Simulate a resumed upload: parts 1 already done, next request is (8, 12)
    // on a FRESH stream that starts at byte 0.
    const blob = new Blob(['aaaabbbbcccc']);
    const src = createStreamPartSourceFromBlob(blob);
    expect(await (await src.partSource(8, 12)).text()).toBe('cccc'); // aaaabbbb discarded
  });

  it('start behind the current position throws (cannot rewind a stream)', async () => {
    const blob = new Blob(['aaaabbbb']);
    const src = createStreamPartSourceFromBlob(blob);
    await src.partSource(4, 8);
    await expect(src.partSource(0, 4)).rejects.toThrow();
  });

  it('stream ending early throws UPLOAD_STREAM_SHORT', async () => {
    const blob = new Blob(['aaaa']);
    const src = createStreamPartSourceFromBlob(blob);
    await expect(src.partSource(4, 8)).rejects.toThrow(/short/i);
  });
});
```

（测试通过 `createStreamPartSourceFromBlob` 辅助：`const createStreamPartSourceFromBlob = (blob: Blob) => createStreamPartSource(blob.stream());`。真实调用方 capture.ts 里 `fetch(url).then(r => r.body)` 取流后传 `createStreamPartSource(stream)`。）

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vital/extension test`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: Implement file-kind.ts + stream-rehost.ts**

`file-kind.ts`：

```ts
import { MAX_UPLOAD_BYTES } from '@vital/dto';

const EXT_TO_KIND: Record<string, 'pdf' | 'video' | 'audio'> = {
  pdf: 'pdf',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mkv: 'video',
  mp3: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', wav: 'audio', flac: 'audio',
};

export function fileKindOf(url: string): 'pdf' | 'video' | 'audio' | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const ext = parsed.pathname.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_KIND[ext] ?? null;
}

export interface DirectFile {
  url: string;
  mime: string;
  size: number;
}

const FILE_MIME = /^(application\/pdf|video\/|audio\/)/;

/** Direct-file gate: whitelisted kind + known length + within cap. */
export function fileModeFromResponse(
  url: string,
  contentType: string,
  contentLength: number | null,
): DirectFile | null {
  const mime = contentType.split(';')[0]?.trim() ?? '';
  if (!FILE_MIME.test(mime)) return null;
  if (contentLength === null || contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES) {
    return null;
  }
  return { url, mime, size: contentLength };
}
```

`stream-rehost.ts`：

```ts
export interface StreamPartSource {
  partSource: (start: number, end: number) => Promise<Blob>;
}

/**
 * Byte-aligned part source over a network stream. Ascending slices consume
 * the stream; a skip (resume) first discards bytes up to `start`. A request
 * behind the current position throws — streams cannot rewind.
 */
export function createStreamPartSource(
  stream: ReadableStream<Uint8Array>,
): StreamPartSource {
  const reader = stream.getReader();
  let consumed = 0;
  let buffer = new Uint8Array(0);

  async function ensure(n: number): Promise<Uint8Array> {
    while (buffer.length < n) {
      const { done, value } = await reader.read();
      if (done || value === undefined) {
        throw new Error(`UPLOAD_STREAM_SHORT: stream ended at ${consumed + buffer.length}, need ${n}`);
      }
      const next = new Uint8Array(buffer.length + value.length);
      next.set(buffer);
      next.set(value, buffer.length);
      buffer = next;
    }
    return buffer;
  }

  async function discard(n: number): Promise<void> {
    await ensure(n);
    buffer = buffer.slice(n);
    consumed += n;
  }

  return {
    async partSource(start: number, end: number): Promise<Blob> {
      if (start < consumed) {
        throw new Error(`UPLOAD_STREAM_REWIND: requested ${start}, already at ${consumed}`);
      }
      if (start > consumed) {
        await discard(start - consumed);
      }
      const need = end - start;
      const data = await ensure(need);
      const part = data.slice(0, need);
      buffer = data.slice(need);
      consumed += need;
      return new Blob([part]);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vital/extension test`
Expected: PASS。

- [ ] **Step 5: messages.ts + popup-state.ts + i18n.ts**

- `messages.ts`：`PopupMode` 加 `'file'`；`CapturePayload` 加 `file: { url: string; mime: string; size: number } | null`；`isCommitPortMessage` mode 校验加 `'file'`。
- `popup-state.ts`：`initialMode` 签名改 `(capture: CapturePayload): PopupMode`（file > selection > article）；新增 `fileMetaLine(file: { mime: string; size: number }): string`（`视频/音频/PDF · 12.3MB`，内部 `formatBytes`）；`modeDisabled` 增加规则：`file` disabled 当 selection 逻辑照旧（file 的 disabled 由 popup main 判断 `capture.file === null`，`modeDisabled` 保持现签名仅管 selection）。
- `i18n.ts`：`progressLabel` 场景扩展无需新 key（复用现有进度文案）；popup 静态文案进 HTML。
- `__tests__/popup-state.test.ts`：`initialMode` 调用改为传 capture fixture；补 `initialMode({...capture, file: {...}}) === 'file'` 用例；`fileMetaLine` 用例。

- [ ] **Step 6: capture.ts — 探测、file 分支、流式 rehost**

1. `extractCapture`（capture.ts，现约 447 行）在 `collectFromTab` **之前**加文件探测（用 `tab.url`，不 executeScript）：

```ts
  const tabUrl = tab.url ?? '';
  if (fileKindOf(tabUrl) !== null) {
    const direct = await probeDirectFile(tabUrl);
    if (direct !== null) {
      return {
        title: fileNameFromUrl(direct.url),
        originalUrl: direct.url,
        extractedText: null, extractedHtml: null, excerpt: null,
        byline: null, siteName: null, imageSrcs: [], selection: '',
        tabId: tab.id ?? null, file: direct,
      };
    }
    // .pdf route serving html → fall through to article mode
  }
```

辅助函数（capture.ts 内）：

```ts
async function probeDirectFile(url: string): Promise<DirectFile | null> {
  try {
    const res = await fetch(url, { method: 'HEAD', credentials: 'omit' });
    if (!res.ok) return null;
    const len = res.headers.get('content-length');
    return fileModeFromResponse(
      url,
      res.headers.get('content-type') ?? '',
      len === null ? null : Number(len),
    );
  } catch {
    return null; // CORS or network → article mode
  }
}

function fileNameFromUrl(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return name === '' ? url : name;
  } catch {
    return url;
  }
}
```

（HEAD 被 405 的站点：探测失败 → 文章模式。CORS 限制是已知现实——多数第三方直链会降级文章模式，spec 已设计。）

现有 `extractCapture` 的文章路径 payload 构造补 `file: null`。

2. 流式 rehost（capture.ts）：

```ts
interface RehostState {
  attachmentId: string;
  size: number;
  mime: string;
}

async function rehostDirectFile(
  file: DirectFile,
  onProgress?: (loaded: number, total: number) => Promise<void> | void,
): Promise<{ attachmentId: string | null; failed: number }> {
  const resumeKey = `vital.rehost.${await sha256Hex(canonicalizeUrl(file.url))}`;
  const stored = await chrome.storage.session.get(resumeKey);
  const prior = stored[resumeKey] as RehostState | undefined;
  try {
    const res = await fetch(file.url, { credentials: 'omit' });
    if (!res.ok || res.body === null) return { attachmentId: null, failed: 1 };
    const source = createStreamPartSource(res.body);
    const uploaded = await getClient().upload({
      partSource: (start, end) => source.partSource(start, end),
      mime: file.mime,
      size: file.size,
      resumeId: prior?.attachmentId,
      onProgress: (loaded, total) => {
        void onProgress?.(loaded, total);
        // Persist resume handle as soon as we have an id — onAttachmentId fires
        // after init; store for crash recovery.
      },
      onAttachmentId: (id) => {
        void chrome.storage.session.set({ [resumeKey]: { attachmentId: id, size: file.size, mime: file.mime } satisfies RehostState });
      },
    });
    await chrome.storage.session.remove(resumeKey);
    return { attachmentId: uploaded.id, failed: 0 };
  } catch {
    return { attachmentId: null, failed: 1 }; // resume state stays for retry
  }
}
```

（`sha256Hex`/`canonicalizeUrl` 从 canonical.ts 已导出——resume key 用 canonical URL（spec ③），utm 参数不产生新 key。CORS 拒绝 → fetch 抛错 → failed=1，item 已建不丢——降级收录。）

3. `commitCapture` 加 file 分支（在 task 分支之前）：

```ts
  if (input.mode === 'file' && capture.file !== null) {
    const file = capture.file;
    const result = await createExtensionItem({ title, originalUrl: file.url, source: 'extension' });
    const outcome: CaptureOutcome = {
      kind: result.created ? 'created' : 'existing',
      id: result.item.id,
    };
    await input.onCreated?.(outcome);
    let failed = 0;
    if (result.created) {
      const totalParts = totalPartsFor(file.size);
      const rehosted = await rehostDirectFile(file, (loaded, total) => {
        // Convert byte progress to part counts for the n/N progress UI.
        const done = Math.min(totalParts, Math.ceil(loaded / partSizeFor(file.size)));
        return input.onProgress?.(done, totalParts);
      });
      if (rehosted.attachmentId !== null) {
        await getClient().patchInboxAssets(result.item.id, {
          assets: [{ attachmentId: rehosted.attachmentId, originalSrc: file.url, sortOrder: 0 }],
        });
      } else {
        failed = 1;
      }
    }
    return { outcome, failed };
  }
```

4. `saveLink`（右键链接）加文件分支：`fileKindOf(href) !== null` 时 `probeDirectFile`，命中则同 file 流程（静默 badge 进度：复用 `report` 通道）。

- [ ] **Step 7: popup main.ts 接入**

- `renderCapture`：`mode === 'file'` 时隐藏 selection/task 模式按钮与清单区，meta 行用 `fileMetaLine(capture.file)`，标题预填 `fileNameFromUrl`（从 capture.title 来——extractCapture 已预填）。
- commit 的 mode 透传（`PopupMode` 已含 file，Port 协议无需改）。
- 静默路径进度：background Port 的 progress 事件已通用（`转存图片 n/N` 文案对 file 场景改为通用 `n/N`——`progressLabel` 改为仅 `n/N` 或保留图片字样，**实现时统一为 `${done}/${total}`**，popup-state 测试同步）。

Run: `pnpm --filter @vital/extension test && pnpm --filter @vital/extension typecheck && pnpm --filter @vital/extension lint && pnpm --filter @vital/extension build`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/extension/src/file-kind.ts apps/extension/__tests__/file-kind.test.ts apps/extension/src/stream-rehost.ts apps/extension/__tests__/stream-rehost.test.ts apps/extension/src/capture.ts apps/extension/src/messages.ts apps/extension/src/popup-state.ts apps/extension/src/i18n.ts apps/extension/entrypoints/popup/main.ts apps/extension/__tests__/popup-state.test.ts
git commit -m "feat(extension): direct-file capture with byte-aligned streaming rehost

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: web Reader — PDF/视频/音频内嵌渲染

**Files:**
- Create: `apps/web/src/features/inbox/ReaderFileAsset.tsx`
- Modify: `apps/web/src/features/inbox/ReaderArticle.tsx`（顶层渲染 file 类 asset）
- Create: `apps/web/__tests__/features/inbox/reader-file-asset.test.tsx`

**Interfaces:**
- Consumes: Task 4 的 `InboxAsset.mime` 与既有 `InboxAsset.url`（签名 URL）。
- Produces: Reader 对 `application/pdf`/`video/*`/`audio/*` asset 的内嵌渲染。

- [ ] **Step 1: Write the failing test**

先看 `apps/web/__tests__/features/inbox/` 现有测试的 render 模式（testing-library）。新建：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReaderFileAsset } from '@/features/inbox/ReaderFileAsset';
import type { InboxAsset } from '@vital/dto';

function asset(mime: string): InboxAsset {
  return {
    id: 'a1', attachmentId: 'att1', url: 'https://s3/x', originalSrc: 'x', sortOrder: 0, mime,
  };
}

describe('ReaderFileAsset', () => {
  it('renders video for video mime', () => {
    render(<ReaderFileAsset asset={asset('video/mp4')} />);
    expect(screen.getByTestId('reader-video').tagName).toBe('VIDEO');
  });
  it('renders iframe for pdf', () => {
    render(<ReaderFileAsset asset={asset('application/pdf')} />);
    expect(screen.getByTestId('reader-pdf').tagName).toBe('IFRAME');
  });
  it('renders audio for audio mime', () => {
    render(<ReaderFileAsset asset={asset('audio/mpeg')} />);
    expect(screen.getByTestId('reader-audio').tagName).toBe('AUDIO');
  });
  it('renders nothing for image mime', () => {
    const { container } = render(<ReaderFileAsset asset={asset('image/jpeg')} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vital/web test -- reader-file-asset`
Expected: FAIL — 组件不存在。

- [ ] **Step 3: Implement**

`ReaderFileAsset.tsx`（样式类名以 InboxReader.tsx 现有 tailwind token 风格为准）：

```tsx
import type { InboxAsset } from '@vital/dto';

export function ReaderFileAsset({ asset }: { asset: InboxAsset }) {
  if (!asset.url) return null;
  if (asset.mime === 'application/pdf') {
    return (
      <iframe
        data-testid="reader-pdf"
        title={asset.originalSrc}
        src={asset.url}
        className="h-[70vh] w-full rounded-lg border border-border"
      />
    );
  }
  if (asset.mime.startsWith('video/')) {
    return (
      <video data-testid="reader-video" controls preload="metadata" src={asset.url} className="w-full rounded-lg" />
    );
  }
  if (asset.mime.startsWith('audio/')) {
    return <audio data-testid="reader-audio" controls preload="metadata" src={asset.url} className="w-full" />;
  }
  return null;
}
```

`ReaderArticle.tsx`：`ReaderArticle` 组件内、`ReaderArticleBody` 之前：

```tsx
const fileAssets = props.assets.filter(
  (a) => a.mime === 'application/pdf' || a.mime.startsWith('video/') || a.mime.startsWith('audio/'),
);
...
{fileAssets.map((a) => (
  <ReaderFileAsset key={a.id} asset={a} />
))}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @vital/web test && pnpm --filter @vital/web exec tsc --noEmit`
Expected: PASS（对照基线 123 + 新增；不新增失败）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/inbox/ReaderFileAsset.tsx apps/web/src/features/inbox/ReaderArticle.tsx apps/web/__tests__/features/inbox/reader-file-asset.test.tsx
git commit -m "feat(web): inline pdf/video/audio rendering in reader

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: 报告编辑器 302 迁移 — 渲染层签名 URL（历史数据零迁移）

**背景**：报告 markdown（bodyMd）持久化 `/api/v1/uploads/<id>` 形式的图片 src 与链接 href（`safeImageSrc` 白名单只放行该形态或绝对 http(s) URL）。**方案：markdown 内容保持稳定引用不迁移；渲染/交互层把该形态替换为签名 URL。** 新增 server JSON 端点 `GET /uploads/:id/url`（复用 `resolveAccessUrl`），web 侧在图片渲染与链接点击处解析。

**Files:**
- Modify: `apps/server/src/uploads/uploads.service.ts`（`getUploadUrl(userId, id): Promise<UploadUrlResponse>`——`resolveAccessUrl` 已有逻辑，包一层校验 ready）
- Modify: `apps/server/src/uploads/uploads.routes.ts`（`GET /api/v1/uploads/:id/url`）
- Modify: `packages/api-client/src/client.ts`（`getUploadUrl(id): Promise<UploadUrlResponse>`）
- Modify: `apps/web/src/features/reports/WysiwygEditor.tsx`（图片 nodeView 的 src 换签名 URL + 缓存 hook）
- Create: `apps/web/src/features/reports/upload-url.ts`（`useUploadUrls(liveMd: string): Record<string, string>` 批量解析 uploads id → 签名 URL 的 hook，带模块级 Map 缓存 + 6 小时 TTL；另导出 `fetchUploadUrl(id: string): Promise<string>` 供插入时立即解析并写缓存）
- Test: `apps/web/__tests__/features/reports/upload-url.test.ts(x)`（新建）

**Interfaces:**
- Consumes: Task 1 `UploadUrlResponse`、`resolveAccessUrl`（service 内部已有）。
- Produces: `getUploadUrl(userId, id)` service、`client.getUploadUrl(id)`、`useUploadUrls(bodyMd: string): Record<string, string>`（uploads id → 签名 URL）。

- [ ] **Step 1: Write the failing test**

server 侧在 `uploads.flow.test.ts` 追加（此文件已在本分支多次修改，继续追加）：

```ts
it('GET /uploads/:id/url returns a signed url for a ready attachment', async () => {
  const alice = await register('alice');
  const { id } = (await initUploadFor(alice)).json();
  // complete it (3 parts)
  storage.headObject.mockResolvedValueOnce({ size: SIZE_3P, contentType: 'video/mp4', lastModified: new Date() });
  await injectJson(app, {
    method: 'POST', url: `/api/v1/uploads/${id}/complete`, token: alice.token,
    payload: { parts: [1, 2, 3].map((n) => ({ partNumber: n, etag: `"e${n}"` })) },
  });
  const res = await injectJson(app, { method: 'GET', url: `/api/v1/uploads/${id}/url`, token: alice.token });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ url: 'https://fake.local/presigned-get', expiresIn: expect.any(Number) });
});

it('GET /uploads/:id/url for a non-ready attachment is 404', async () => {
  const alice = await register('alice');
  const { id } = (await initUploadFor(alice)).json();
  const res = await injectJson(app, { method: 'GET', url: `/api/v1/uploads/${id}/url`, token: alice.token });
  expect(res.statusCode).toBe(404);
});
```

web 侧 `upload-url.test.ts`：从 bodyMd 提取 uploads id 的纯函数 + 缓存命中行为（mock client）。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vital/server test -- uploads.flow`
Expected: FAIL — 路由不存在。

- [ ] **Step 3: Implement**

server：

```ts
// service
export async function getUploadUrl(userId: string, id: string): Promise<UploadUrlResponse> {
  const row = await getOwnedAttachmentOr404(userId, id);
  if (row.status !== 'ready') throw AppError.of(404, 'ATTACHMENT_NOT_FOUND');
  const url = await getStorage().generateAccessUrl(row.s3Key, row.storageMeta, config.PRESIGN_GET_TTL_SECONDS);
  return { url, expiresIn: config.PRESIGN_GET_TTL_SECONDS };
}
// route
app.get('/api/v1/uploads/:id/url', { preHandler: [requireAuth] }, async (req) => {
  const user = req.user; if (!user) throw AppError.of(401, 'INVALID_TOKEN');
  const { id } = idParams.parse(req.params);
  return getUploadUrl(user.id, id);
});
```

api-client：`getUploadUrl: (id) => http.request(`/api/v1/uploads/${id}/url`)`。

web `upload-url.ts`：

```ts
const UPLOAD_ID_RE = /\/api\/v1\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function uploadIdsOf(bodyMd: string): string[] { /* 去重提取 */ }
export function useUploadUrls(bodyMd: string): Record<string, string> {
  // 模块级 Map<id, {url, at}> 缓存，TTL 6h；useEffect 内并发 fetch 未命中项；
  // 状态存 useState。返回 id→url 映射；未解析的 id 不在结果里。
}
```

`WysiwygEditor.tsx`：图片渲染处——`useUploadUrls` 的数据源**不是静态 bodyMd prop，而是 editor 的实时内容**（否则会话内新插入的图片解析不到）：

1. WysiwygEditor 维护 `liveMd` state（现有 onUpdate 里已有序列化逻辑产出 md——`serializePmJSONToMarkdown(instance.getJSON())`，把该结果同时 setState）；`useUploadUrls(liveMd)` 以实时内容为键，新插图（`uploadReportFile → setImage({src:'/api/v1/uploads/<id>'})`）的 id 进入下一次解析。
2. nodeView：自定义 `Image` extension（`Image.extend({ addNodeView() { ... } })`，现有 `Image.configure({inline:true, allowBase64:false})` 改为 extend 形式），nodeView 渲染 `<img src={resolveSrc(node.attrs.src)}>`（纯 DOM node view；`resolveSrc` 查 `useUploadUrls` 的映射，查不到时先渲染原 src，映射到位后由 React 重渲染触发 nodeView 更新——nodeView 内部监听映射版本号或用 `editor.view.dispatch` 触发；若纯 DOM nodeView 的更新链路卡住，fallback 到 ReactNodeViewRenderer）。原始 `attrs.src` 不变（markdown 持久化不变）。
3. **新插图立即解析**：`uploadReportFile` 返回后、`setImage` 之前，调 `upload-url.ts` 导出的 `fetchUploadUrl(id)`（该函数同时写入模块级缓存）取签名 URL 并更新映射 state——新插图无需等 liveMd 重解析。
4. 链接 href：编辑器容器上一处 `click` 拦截——命中 `/api/v1/uploads/<id>` 形态的 href 时 `resolveSrc(href)` 后 `window.open`；持久化的 markdown 不动。

（以上实现路径写明给实现者；若 nodeView 实现遇阻，fallback：`editorProps.transformPHTML` 不存在——**次选方案**：编辑器 container 上一个全局 `click` 拦截 + 图片走 nodeView。实现者按首选做，卡住按次选，都不行则回报 BLOCKED 而非自造方案。）

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @vital/server test && pnpm --filter @vital/web test && pnpm --filter @vital/api-client test
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/uploads/uploads.service.ts apps/server/src/uploads/uploads.routes.ts apps/server/__tests__/uploads.flow.test.ts packages/api-client/src/client.ts apps/web/src/features/reports/WysiwygEditor.tsx apps/web/src/features/reports/upload-url.ts apps/web/__tests__/features/reports/upload-url.test.tsx
git commit -m "feat(web): report editor renders upload refs via signed urls; history-safe 302 removal

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: 全仓清理与端到端验证

**Files:**
- Modify: 清理 grep 残留（`MAX_IMAGE_BYTES`、`uploadPresignInputSchema`、`presignPut`、`xhrPut`、`fetchPut`、`putWithProgress`、`uploadUrl(`、`/uploads/presign`）

**Interfaces:**
- Consumes: 全部前序任务。
- Produces: 无（终点任务）。

- [ ] **Step 1: 残留清理**

```bash
grep -rn "MAX_IMAGE_BYTES\|uploadPresignInputSchema\|presignPut\|xhrPut\|fetchPut\|putWithProgress\|fileUri\|fetchUploadBlob\|completeUpload" \
  packages apps --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist | grep -v ".wxt"
```

逐项处理：

- `MAX_IMAGE_BYTES`：`packages/dto/src/uploads.ts` 删除该常量与 `@deprecated` 注释；引用方（`apps/extension/src/capture.ts` 的图片转存 size 上限、page-scripts.ts 的 `fetchImagesInPage` 参数）改为 `MAX_UPLOAD_BYTES`（图片转存上限随协议放宽——`MIN_IMAGE_BYTES` 保留防 tracking pixel）。
- `uploadPresignInputSchema`/`UploadPresignInput`/`UploadPresignResponse`：DTO 里删除（T1 标记 deprecated 的旧类型）。
- `client.fetchUploadBlob`（GET 已删的 302 路由，apps 源码零调用方）：api-client client.ts 删除该接口方法与实现；`apps/web/__tests__/features/inbox/inbox.test.tsx` 的陈旧 mock 与 `packages/api-client/__tests__/http.test.ts` 的 requestBlob 相关断言同步删除/更新。
- `client.completeUpload`（api-client 暴露的裸方法，POST `{}` 到新 complete 路由——新协议必须有 parts，语义已坏）：client.ts 接口与实现删除（multipart complete 只由 upload() 内部调用）。
- 其余项应已在前序任务清零——grep 结果非空则逐个清。

- [ ] **Step 2: 全量验证**

```bash
pnpm --filter @vital/dto test && pnpm --filter @vital/api-client test && \
pnpm --filter @vital/server test && pnpm --filter @vital/extension test && \
pnpm --filter @vital/web test && \
pnpm --filter @vital/server typecheck && pnpm --filter @vital/api-client typecheck && \
pnpm --filter @vital/extension typecheck && pnpm --filter @vital/extension build && \
pnpm --filter @vital/web exec tsc --noEmit
```

Expected: 全绿，对照基线（dto ≥45、server ≥136+新增、web ≥123+新增、extension ≥37+新增）无回退。

- [ ] **Step 3: Commit**

```bash
git add <清理涉及的文件>
git commit -m "chore: remove legacy upload references after multipart migration

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review 结论（rev2）

- **评审 Blocker 全部落实**：B1（ETag 统一：T1 定义含 etag、T2 实现取 `p.ETag ?? ''`、T3 mock 全带 etag、T5 complete 全量组装，删除旧稿自相矛盾段落）；B2（InboxAsset.mime 挪 T4，无跨任务暂红）；B3（错误码 service 层显式：413/422/409，schema 只管形状）；B4（报告 302：渲染层签名 URL，历史 markdown 零迁移，Task 8 落地）；B5（S3 PUT 走 `options.fetchImpl ?? fetch`，web/tauri client.ts 列入 T5 Files 并跑 typecheck）；B6（用户 WIP 已落盘 6334a0a，工作区干净）。
- **Important 全部落实**：I1（stream-rehost 字节对齐 + 跳片丢弃单测）；I2（未知长度一律 null，无 size:0 路径）；I3（fileUri 形态删除）；I4（409 回退重试 + 测试）；I5（S3 PUT mock 带 ETag header）；I6（expo 新 File 类 implements Blob，mobile 传 `file: new File(uri)`）；I7（mobile api.ts/rn-put.ts/client.test.ts 全部列入 T5 Files）；I8（合法 UUID 字符串）；I9（T4 测试 installMockStorage）。
- **Minor 落实**：M1（listParts 分页单测）；M2（sweeper uploadId 用例入 T3）；M3（MAX_IMAGE_BYTES 引用归属 T9，指向 capture.ts）；M4（probeDirectFile/fileNameFromUrl 完整实现给出，extractCapture 落点标明）；M5（MIME 收紧 pdf/video/audio，image/* 不进文件模式）；M6（resume 进度基数）；M8（partSource 定义统一 T5，T6/T8 消费）。
- **Spec 覆盖**：全部需求（含 rev2 的报告迁移方案）映射到 T1-T9；spec ⑤ 的 409 回退在 T5 实现。
