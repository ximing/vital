# 扩展 Evernote 式弹窗收集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工具栏点击打开 Evernote 式弹窗（文章/选区/待办三模式，预填解析结果，转存进度条），保留快捷键与右键的静默快存，删除独立编辑窗口与草稿中转。

**Architecture:** 新增 WXT popup entrypoint（vanilla DOM，无 React）+ `popup-state.ts` 纯函数层；background 通过既有 RPC（`sendMessage`）提供 `capture-active-tab`，提交走命名 Port（`vital-commit`）以流式推送图片转存进度；提取逻辑从 `saveAndEdit`/`commitDraft` 收敛为 `extractCapture`/`commitCapture` 两个共享函数。

**Tech Stack:** WXT 0.20（MV3 service worker）、TypeScript、vitest、@vital/dto、@vital/api-client。

**Spec:** `docs/superpowers/specs/2026-09-08-extension-popup-capture-design.md`

## Global Constraints

- **工作区有大量无关未提交改动**（inbox wechat 等）。提交时**只 `git add` 本任务明确列出的文件**，绝不用 `git add -A` / `git add .`。
- 扩展内**禁止引入 React**；UI 为 vanilla DOM + 手写样式（沿用 `entrypoints/options/index.html` 的调色板）。
- 所有用户可见文案中文、集中管理在 `apps/extension/src/i18n.ts` 的 `copy` 对象；不在组件里硬编码新文案。
- 测试命令（仓库根目录）：`pnpm --filter @vital/extension test`；类型：`pnpm --filter @vital/extension typecheck`；构建：`pnpm --filter @vital/extension build`。
- 仓库测试约定：chrome API 密集的编排层（`capture.ts`）不写单测；纯函数（`capture-helpers.ts`、`popup-state.ts`、`messages.ts` guards）必须有 vitest 单测。
- `minimum_chrome_version` 提升到 `'127'`（`chrome.action.openPopup()`），所有 `openPopup` 调用必须 try/catch 回退。
- 提交信息用 conventional commits（`feat:`/`refactor:`/`test:`/`chore:`），结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 保留 `Alt+Shift+V`（`save-page` 命令）与全部右键直存菜单的静默快存行为，不得改动其保存语义。
- `exchange-code` RPC **保留**（popup 以标签页打开时的 `?code=` 登录回退路径用到它；spec 原文写删除，已在 spec 修订任务中更正）。

---

### Task 1: messages.ts — 新协议类型与 guards（纯增量）

**Files:**
- Modify: `apps/extension/src/messages.ts`
- Test: `apps/extension/__tests__/messages.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）。
- Produces（后续任务依赖的精确签名）:
  - `export type PopupMode = 'article' | 'selection' | 'task'`
  - `export interface CapturePayload { title: string; originalUrl: string; extractedText: string | null; extractedHtml: string | null; excerpt: string | null; byline: string | null; siteName: string | null; imageSrcs: string[]; selection: string; tabId: number | null }`
  - `export const COMMIT_PORT_NAME = 'vital-commit'`
  - `export interface CommitPortMessage { type: 'commit-capture'; capture: CapturePayload; title: string; note: string; mode: PopupMode; listId?: string }`
  - `export type CommitPortEvent = { type: 'created'; kind: SaveKind; id: string } | { type: 'progress'; done: number; total: number } | { type: 'done'; failed: number } | { type: 'error'; message: string }`
  - `export function isCommitPortMessage(value: unknown): value is CommitPortMessage`
  - `PanelRequest` 增加 `{ type: 'capture-active-tab' }`；`PanelResponse` 增加 `{ ok: true; capture: CapturePayload | null }`

- [ ] **Step 1: Write the failing test**

在 `apps/extension/__tests__/messages.test.ts` 顶部 import 区改为：

```ts
import { describe, expect, it } from 'vitest';
import {
  isCommitPortMessage,
  isOffscreenParse,
  isPanelRequest,
  type CapturePayload,
} from '../src/messages.js';

const payload: CapturePayload = {
  title: '标题',
  originalUrl: 'https://ex.com/a',
  extractedText: null,
  extractedHtml: null,
  excerpt: null,
  byline: null,
  siteName: null,
  imageSrcs: [],
  selection: '',
  tabId: null,
};
```

在 `describe('message guards', ...)` 内追加：

```ts
  it('accepts capture-active-tab and commit port shapes', () => {
    expect(isPanelRequest({ type: 'capture-active-tab' })).toBe(true);
    expect(
      isCommitPortMessage({
        type: 'commit-capture',
        capture: payload,
        title: 't',
        note: '',
        mode: 'article',
      }),
    ).toBe(true);
    expect(
      isCommitPortMessage({
        type: 'commit-capture',
        capture: payload,
        title: 't',
        note: '',
        mode: 'nope',
      }),
    ).toBe(false);
    expect(
      isCommitPortMessage({ type: 'commit-capture', capture: null, title: '', note: '', mode: 'task' }),
    ).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vital/extension test`
Expected: FAIL — `isCommitPortMessage` 不存在（import 报错）。

- [ ] **Step 3: Write minimal implementation**

`apps/extension/src/messages.ts` 顶部 import 区增加（`SaveKind` 来自 capture-helpers，type-only 导入避免运行时环依赖）：

```ts
import type { SaveKind } from './capture-helpers.js';
```

在 `CaptureDraft` 接口之后新增：

```ts
export type PopupMode = 'article' | 'selection' | 'task';

export interface CapturePayload {
  title: string;
  originalUrl: string;
  extractedText: string | null;
  extractedHtml: string | null;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
  imageSrcs: string[];
  selection: string;
  tabId: number | null;
}

export const COMMIT_PORT_NAME = 'vital-commit';

export interface CommitPortMessage {
  type: 'commit-capture';
  capture: CapturePayload;
  title: string;
  note: string;
  mode: PopupMode;
  listId?: string;
}

export type CommitPortEvent =
  | { type: 'created'; kind: SaveKind; id: string }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; failed: number }
  | { type: 'error'; message: string };
```

`PanelRequest` 联合类型增加一行 `| { type: 'capture-active-tab' }`；`PanelResponse` 联合类型增加一行 `| { ok: true; capture: CapturePayload | null }`。

`isPanelRequest` 的 return 表达式增加 `value.type === 'capture-active-tab' ||`。

文件末尾新增 guard：

```ts
export function isCommitPortMessage(value: unknown): value is CommitPortMessage {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  if (rec.type !== 'commit-capture') return false;
  if (typeof rec.title !== 'string' || typeof rec.note !== 'string') return false;
  if (rec.mode !== 'article' && rec.mode !== 'selection' && rec.mode !== 'task') return false;
  if (rec.listId !== undefined && typeof rec.listId !== 'string') return false;
  if (typeof rec.capture !== 'object' || rec.capture === null) return false;
  const cap = rec.capture as Record<string, unknown>;
  return (
    typeof cap.title === 'string' &&
    typeof cap.originalUrl === 'string' &&
    Array.isArray(cap.imageSrcs) &&
    typeof cap.selection === 'string'
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vital/extension test`
Expected: PASS（全部文件）。

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/messages.ts apps/extension/__tests__/messages.test.ts
git commit -m "feat(extension): add popup capture protocol types and guards

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: capture-helpers.ts — 按模式构造提交输入的纯函数

**Files:**
- Modify: `apps/extension/src/capture-helpers.ts`
- Test: `apps/extension/__tests__/capture-helpers.test.ts`

**Interfaces:**
- Consumes: `CapturePayload`（Task 1）。
- Produces:
  - `export function inboxInputFromCapture(capture: CapturePayload, title: string, note: string): CreateInboxInput` — 文章模式
  - `export function selectionInputFromCapture(capture: CapturePayload, title: string): CreateInboxInput` — 选区模式
  - 两个函数都固定 `source: 'extension'`。

- [ ] **Step 1: Write the failing test**

在 `apps/extension/__tests__/capture-helpers.test.ts` 顶部 import 区增加：

```ts
import type { CapturePayload } from '../src/messages.js';
import { inboxInputFromCapture, selectionInputFromCapture } from '../src/capture-helpers.js';

const capture: CapturePayload = {
  title: '文章标题',
  originalUrl: 'https://ex.com/a',
  extractedText: '正文',
  extractedHtml: '<p>正文</p>',
  excerpt: '旧摘',
  byline: '作者',
  siteName: 'Example',
  imageSrcs: ['https://ex.com/1.png'],
  selection: '一段<script>选区',
  tabId: 7,
};
```

文件末尾追加：

```ts
describe('inboxInputFromCapture', () => {
  it('maps the article payload and lets a note replace the excerpt', () => {
    expect(inboxInputFromCapture(capture, '新标题', '备注')).toEqual({
      title: '新标题',
      originalUrl: 'https://ex.com/a',
      extractedText: '正文',
      extractedHtml: '<p>正文</p>',
      excerpt: '备注',
      byline: '作者',
      siteName: 'Example',
      source: 'extension',
    });
  });

  it('keeps the parsed excerpt when the note is empty', () => {
    expect(inboxInputFromCapture(capture, '新标题', '').excerpt).toBe('旧摘');
  });
});

describe('selectionInputFromCapture', () => {
  it('escapes the selection into one paragraph and drops article fields', () => {
    expect(selectionInputFromCapture(capture, '选区标题')).toEqual({
      title: '选区标题',
      originalUrl: 'https://ex.com/a',
      extractedText: '一段<script>选区',
      extractedHtml: '<p>一段&lt;script&gt;选区</p>',
      excerpt: '一段<script>选区',
      byline: null,
      siteName: 'Example',
      source: 'extension',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vital/extension test`
Expected: FAIL — 两个函数未导出。

- [ ] **Step 3: Write minimal implementation**

`apps/extension/src/capture-helpers.ts` 顶部 import 区增加：

```ts
import type { CreateInboxInput } from '@vital/dto';
import { clip, escapeParagraph } from './html.js';
import type { CapturePayload } from './messages.js';
```

文件末尾（`isTrustedWebOrigin` 之后）追加：

```ts
export function inboxInputFromCapture(
  capture: CapturePayload,
  title: string,
  note: string,
): CreateInboxInput {
  return {
    title,
    originalUrl: capture.originalUrl,
    extractedText: capture.extractedText,
    extractedHtml: capture.extractedHtml,
    excerpt: clip(note, 500) ?? capture.excerpt,
    byline: capture.byline,
    siteName: capture.siteName,
    source: 'extension',
  };
}

export function selectionInputFromCapture(
  capture: CapturePayload,
  title: string,
): CreateInboxInput {
  return {
    title,
    originalUrl: capture.originalUrl,
    extractedText: clip(capture.selection, 2 * 1024 * 1024),
    extractedHtml: escapeParagraph(capture.selection),
    excerpt: clip(capture.selection, 500),
    byline: null,
    siteName: capture.siteName,
    source: 'extension',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vital/extension test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/capture-helpers.ts apps/extension/__tests__/capture-helpers.test.ts
git commit -m "feat(extension): pure per-mode capture input builders

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: popup-state.ts — 弹窗纯状态函数

**Files:**
- Create: `apps/extension/src/popup-state.ts`
- Test: `apps/extension/__tests__/popup-state.test.ts`

**Interfaces:**
- Consumes: `CapturePayload`、`PopupMode`（Task 1）；`SaveKind`、`savedAfterImagesToast`（capture-helpers）。
- Produces:
  - `export function initialMode(selection: string): PopupMode`
  - `export function modeDisabled(mode: PopupMode, selection: string): boolean`
  - `export function titleForMode(capture: CapturePayload, mode: PopupMode): string`
  - `export function metaLine(capture: CapturePayload, mode: PopupMode): string`
  - `export function progressLabel(done: number, total: number): string`
  - `export function savedLabel(kind: SaveKind, failed: number): string`

- [ ] **Step 1: Write the failing test**

创建 `apps/extension/__tests__/popup-state.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { CapturePayload } from '../src/messages.js';
import {
  initialMode,
  metaLine,
  modeDisabled,
  progressLabel,
  savedLabel,
  titleForMode,
} from '../src/popup-state.js';

const capture: CapturePayload = {
  title: '文章标题',
  originalUrl: 'https://ex.com/a',
  extractedText: '正'.repeat(2000),
  extractedHtml: '<p>正文</p>',
  excerpt: null,
  byline: '作者',
  siteName: 'Example',
  imageSrcs: ['https://ex.com/1.png', 'https://ex.com/2.png'],
  selection: '一段选区',
  tabId: 7,
};

describe('initialMode / modeDisabled', () => {
  it('prefers selection when the page has one', () => {
    expect(initialMode('  一段选区  ')).toBe('selection');
    expect(initialMode('   ')).toBe('article');
    expect(modeDisabled('selection', '')).toBe(true);
    expect(modeDisabled('selection', '   ')).toBe(true);
    expect(modeDisabled('selection', '有字')).toBe(false);
    expect(modeDisabled('article', '')).toBe(false);
    expect(modeDisabled('task', '')).toBe(false);
  });
});

describe('titleForMode', () => {
  it('uses the parsed title for articles and clips the selection otherwise', () => {
    expect(titleForMode(capture, 'article')).toBe('文章标题');
    expect(titleForMode(capture, 'selection')).toBe('一段选区');
    expect(titleForMode({ ...capture, selection: '' }, 'task')).toBe('文章标题');
  });
});

describe('metaLine', () => {
  it('shows site, word count, and image count for articles', () => {
    expect(metaLine(capture, 'article')).toBe('Example · 2000 字 · 2 张图');
  });

  it('falls back to hostname and hides empty parts', () => {
    const bare = { ...capture, siteName: null, extractedText: null, imageSrcs: [] };
    expect(metaLine(bare, 'article')).toBe('ex.com');
    expect(metaLine(capture, 'selection')).toBe('4 字');
  });
});

describe('saved / progress labels', () => {
  it('reuses toast copy and appends image failures', () => {
    expect(savedLabel('task', 0)).toBe('已保存为待办');
    expect(savedLabel('existing', 0)).toBe('这篇已经在稍后读');
    expect(savedLabel('created', 0)).toBe('已保存到 Vital');
    expect(savedLabel('created', 2)).toBe('已保存，2 张图失败');
    expect(progressLabel(2, 5)).toBe('转存图片 2/5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vital/extension test`
Expected: FAIL — `../src/popup-state.js` 模块不存在。

- [ ] **Step 3: Write minimal implementation**

创建 `apps/extension/src/popup-state.ts`：

```ts
import { clip, hostnameOf } from './html.js';
import { copy } from './i18n.js';
import type { CapturePayload, PopupMode } from './messages.js';
import { savedAfterImagesToast, type SaveKind } from './capture-helpers.js';

export function initialMode(selection: string): PopupMode {
  return selection.trim() !== '' ? 'selection' : 'article';
}

export function modeDisabled(mode: PopupMode, selection: string): boolean {
  return mode === 'selection' && selection.trim() === '';
}

export function titleForMode(capture: CapturePayload, mode: PopupMode): string {
  if (mode === 'selection') return clip(capture.selection, 80) ?? capture.originalUrl;
  if (mode === 'task') return clip(capture.selection, 80) ?? capture.title;
  return capture.title;
}

export function metaLine(capture: CapturePayload, mode: PopupMode): string {
  if (mode === 'selection') return `${capture.selection.trim().length} 字`;
  const parts: string[] = [];
  const site = capture.siteName ?? hostnameOf(capture.originalUrl);
  if (site !== null && site !== '') parts.push(site);
  const words = capture.extractedText?.trim().length ?? 0;
  if (words > 0) parts.push(`${words} 字`);
  if (capture.imageSrcs.length > 0) parts.push(`${capture.imageSrcs.length} 张图`);
  return parts.join(' · ');
}

export function progressLabel(done: number, total: number): string {
  return `转存图片 ${done}/${total}`;
}

export function savedLabel(kind: SaveKind, failed: number): string {
  if (kind === 'task') return copy.toastTaskSaved;
  if (kind === 'existing') return copy.toastAlready;
  return savedAfterImagesToast(failed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vital/extension test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/popup-state.ts apps/extension/__tests__/popup-state.test.ts
git commit -m "feat(extension): popup pure state helpers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: capture/client/background — 提取与提交管线切换

把 `saveAndEdit`/`commitDraft` 的逻辑收敛为 `extractCapture`/`commitCapture`；右键「保存并编辑」、`save-and-edit` 命令、未登录提示全部改道 `chrome.action.openPopup()`（带回退）。本任务**不动** messages.ts 的草稿 RPC、不删 options entrypoint（Task 6 做），保证每个提交可编译。

**Files:**
- Modify: `apps/extension/src/capture.ts`（约 20 处：删 `saveAndEdit`/`openPanel`，新增三个导出，改 3 个 handler）
- Modify: `apps/extension/src/client.ts`（`handlePanelMessage` 增加 `capture-active-tab` case）
- Modify: `apps/extension/entrypoints/background.ts`（onConnect 监听）
- Modify: `apps/extension/src/i18n.ts`（删 `menuRecent`）

**Interfaces:**
- Consumes: `CapturePayload`、`PopupMode`、`COMMIT_PORT_NAME`、`CommitPortEvent`（Task 1）；`inboxInputFromCapture`、`selectionInputFromCapture`（Task 2）；`titleForMode`（Task 3）。
- Produces:
  - `export async function extractCapture(tab: chrome.tabs.Tab): Promise<CapturePayload>`（throw `copy.toastRestricted` 于受限页）
  - `export async function captureActiveTabPayload(): Promise<CapturePayload>`
  - `export interface CommitResult { outcome: CaptureOutcome; failed: number }`
  - `export async function commitCapture(input: { capture: CapturePayload; title: string; note: string; mode: PopupMode; listId?: string; onCreated?: (outcome: CaptureOutcome) => Promise<void> | void; onProgress?: (done: number, total: number) => Promise<void> | void }): Promise<CommitResult>`
  - `export async function openCapturePopup(): Promise<void>`（openPopup 失败 → 打开网页版 inbox）
  - `export async function setBadge(text: string): Promise<void>`（原私有函数改为导出）

- [ ] **Step 1: capture.ts — 新增提取与提交函数**

`apps/extension/src/capture.ts` import 区调整：

```ts
// 删除：
// import { saveDraft } from './draft-store.js';
// import { PANEL_PATH, WEB_URL } from './config.js';
// 改为：
import { WEB_URL } from './config.js';
// capture-helpers 导入列表增加 extensionLoginUrl、inboxInputFromCapture、selectionInputFromCapture、badgeText：
import {
  badgeText,
  extensionLoginUrl,
  feedbackView,
  inboxInputFromCapture,
  inboxListUrl,
  inboxReaderUrl,
  selectionInputFromCapture,
  taskNotesFromCapture,
  type SaveFeedbackEvent,
  type SaveKind,
} from './capture-helpers.js';
// messages 导入（新增）：
import type { CapturePayload, PopupMode } from './messages.js';
// popup-state 导入（新增）：
import { titleForMode } from './popup-state.js';
```

`MENU` 常量删除 `recent: 'vital-open-recent'` 一行。

`setBadge` 函数签名由 `async function setBadge(` 改为 `export async function setBadge(`。

在 `saveAndEdit` 原位置（整个函数删除）替换为：

```ts
export async function extractCapture(tab: chrome.tabs.Tab): Promise<CapturePayload> {
  const tabId = tab.id;
  if (tabId === undefined) throw new Error(copy.toastFailed);
  const page = await collectFromTab(tabId);
  const originalUrl = isHttpUrl(page.url) ? page.url : tab.url;
  if (originalUrl === undefined || !isHttpUrl(originalUrl)) {
    throw new Error(copy.toastRestricted);
  }
  const payload: CapturePayload = {
    title: clip(page.title, 500) ?? hostnameOf(originalUrl) ?? originalUrl,
    originalUrl,
    extractedText: null,
    extractedHtml: null,
    excerpt: null,
    byline: null,
    siteName: null,
    imageSrcs: [],
    selection: page.selection.trim(),
    tabId,
  };
  try {
    const parsed = await parseInOffscreen(page.outerHTML, originalUrl);
    return {
      ...payload,
      title: parsed.title,
      extractedText: parsed.extractedText,
      extractedHtml: parsed.extractedHtml,
      excerpt: parsed.excerpt,
      byline: parsed.byline,
      siteName: parsed.siteName,
      imageSrcs: parsed.imageSrcs,
    };
  } catch {
    return payload;
  }
}

export async function captureActiveTabPayload(): Promise<CapturePayload> {
  const tab = await activeTab();
  if (tab === undefined) throw new Error(copy.toastFailed);
  return extractCapture(tab);
}

export interface CommitResult {
  outcome: CaptureOutcome;
  failed: number;
}

export async function commitCapture(input: {
  capture: CapturePayload;
  title: string;
  note: string;
  mode: PopupMode;
  listId?: string;
  onCreated?: (outcome: CaptureOutcome) => Promise<void> | void;
  onProgress?: (done: number, total: number) => Promise<void> | void;
}): Promise<CommitResult> {
  const { capture } = input;
  const title = input.title.trim() === '' ? titleForMode(capture, input.mode) : input.title.trim();
  if (input.mode === 'task') {
    const task = await getClient().createTask({
      title,
      listId: input.listId ?? (await inboxListId()),
      notes: taskNotesFromCapture(capture.originalUrl, input.note || capture.selection),
      timeBucket: 'anytime',
    });
    const outcome: CaptureOutcome = { kind: 'task', id: task.id };
    await input.onCreated?.(outcome);
    return { outcome, failed: 0 };
  }
  const base =
    input.mode === 'selection'
      ? selectionInputFromCapture(capture, title)
      : inboxInputFromCapture(capture, title, input.note);
  const result = await createExtensionItem(base);
  const outcome: CaptureOutcome = {
    kind: result.created ? 'created' : 'existing',
    id: result.item.id,
  };
  await input.onCreated?.(outcome);
  if (result.created && input.mode === 'article') {
    const images = await gatherImages(capture.tabId ?? undefined, capture.imageSrcs);
    const { failed } = await rehostImages(result.item, images, input.onProgress);
    return { outcome, failed };
  }
  return { outcome, failed: 0 };
}

export async function openCapturePopup(): Promise<void> {
  try {
    await chrome.action.openPopup();
  } catch {
    // Popup already open, or the API is policy-disabled: fall back to the web inbox.
    await chrome.tabs.create({ url: inboxListUrl(WEB_URL) });
  }
}

async function promptLogin(tab: chrome.tabs.Tab | undefined): Promise<void> {
  await announce(tab, { type: 'fail', message: copy.toastLogin });
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.tabs.create({ url: extensionLoginUrl(WEB_URL, chrome.runtime.id) });
  }
}
```

- [ ] **Step 2: capture.ts — 改写入口 handler，删除旧路径**

1. 删除 `openPanel` 函数（`chrome.windows.create` 那个）。
2. `withAuth` 的未登录分支 `await openPanel();` 改为 `await promptLogin(tab);`。
3. `handleCommand` 的 `saveEdit` 分支整体替换为：

```ts
  if (command === COMMAND.saveEdit) {
    await openCapturePopup();
    return;
  }
```

（`withAuth` 不再包裹 —— 弹窗自己处理登录态。）

4. `handleContextMenu`：删除 `if (info.menuItemId === MENU.recent) {...}` 分支；`MENU.edit` 分支替换为：

```ts
  if (info.menuItemId === MENU.edit) {
    await openCapturePopup();
    return;
  }
```

5. `registerMenus` 删除 `chrome.contextMenus.create({ id: MENU.recent, ... })` 那段（action context 菜单项）。
6. **保留** `commitDraft`（Task 6 才删；client.ts 仍引用）。它会因 `saveDraft` import 删除而报错——`commitDraft` 内部 `const { readDraft, clearDraft } = await import('./draft-store.js')` 是动态 import，不受顶部 import 删除影响，保持原样即可编译。

- [ ] **Step 3: client.ts — 增加 capture-active-tab case**

`apps/extension/src/client.ts` 的 `handlePanelMessage` switch 中，在 `case 'commit-draft'` 之前插入：

```ts
    case 'capture-active-tab': {
      try {
        const { captureActiveTabPayload } = await import('./capture.js');
        return { ok: true, capture: await captureActiveTabPayload() };
      } catch {
        return { ok: true, capture: null };
      }
    }
```

（返回 `null` 而非 error，让弹窗显示「无法收集此页」而非通用错误。）

- [ ] **Step 4: background.ts — commit Port 监听**

`apps/extension/entrypoints/background.ts` import 区增加：

```ts
import { badgeText } from '../src/capture-helpers.js';
import { setBadge } from '../src/capture.js';
import {
  COMMIT_PORT_NAME,
  isCommitPortMessage,
  type CommitPortEvent,
} from '../src/messages.js';
```

`main()` 内、`chrome.runtime.onMessageExternal` 监听之前插入：

```ts
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== COMMIT_PORT_NAME) return;
      let alive = true;
      port.onDisconnect.addListener(() => {
        alive = false;
      });
      port.onMessage.addListener((message) => {
        if (!isCommitPortMessage(message)) return;
        void (async () => {
          const send = async (event: CommitPortEvent): Promise<void> => {
            if (alive) {
              try {
                port.postMessage(event);
                return;
              } catch {
                alive = false;
              }
            }
            // Popup closed mid-commit: degrade progress to the toolbar badge; the
            // commit itself keeps running so no data is lost.
            if (event.type === 'progress') await setBadge(badgeText('progress', event));
          };
          try {
            const { commitCapture } = await import('../src/capture.js');
            const { failed } = await commitCapture({
              capture: message.capture,
              title: message.title,
              note: message.note,
              mode: message.mode,
              listId: message.listId,
              onCreated: (outcome) =>
                send({ type: 'created', kind: outcome.kind, id: outcome.id }),
              onProgress: (done, total) => send({ type: 'progress', done, total }),
            });
            await send({ type: 'done', failed });
          } catch (err) {
            const { errorMessage } = await import('../src/client.js');
            await send({ type: 'error', message: errorMessage(err) });
          }
        })();
      });
    });
```

- [ ] **Step 5: i18n.ts — 删除 menuRecent**

`apps/extension/src/i18n.ts` 删除 `menuRecent: '最近保存',` 一行（grep 确认无其他引用：`grep -rn "menuRecent" apps/extension --include="*.ts" | grep -v i18n.ts` 应为空）。

- [ ] **Step 6: Verify — typecheck + 全部测试**

Run: `pnpm --filter @vital/extension typecheck && pnpm --filter @vital/extension test`
Expected: 两者都 PASS（options entrypoint 仍存在且其用到的 RPC 未删，编译完整）。

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/capture.ts apps/extension/src/client.ts apps/extension/entrypoints/background.ts apps/extension/src/i18n.ts
git commit -m "refactor(extension): shared extract/commit pipeline, openPopup entries

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: popup entrypoint + manifest 契约反转

创建弹窗 UI（WXT `entrypoints/popup/`），显式声明 `default_popup`，`minimum_chrome_version` 提到 127，manifest 契约测试从「不得有 popup」反转为「必须有」。popup 支持 `?code=` 登录回退（以标签页打开时）。

**Files:**
- Create: `apps/extension/entrypoints/popup/index.html`
- Create: `apps/extension/entrypoints/popup/main.ts`
- Modify: `apps/extension/wxt.config.ts`
- Modify: `apps/extension/src/i18n.ts`（新增 popup 文案）
- Test: `apps/extension/__tests__/manifest.test.ts`

**Interfaces:**
- Consumes: 全部前序任务的 RPC/Port 协议与纯函数。
- Produces: `popup.html`（web 回退路径，Task 6 使用）。

- [ ] **Step 1: 改写 manifest 契约测试（先失败）**

`apps/extension/__tests__/manifest.test.ts` 整体替换为：

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relative: string): string => readFileSync(path.resolve(root, relative), 'utf8');

describe('extension manifest contract', () => {
  it('declares a toolbar popup for capture and keeps Alt+Shift+V silent save', () => {
    const config = read('wxt.config.ts');
    expect(config).toContain("'save-page'");
    expect(config).toContain('Alt+Shift+V');
    expect(config).toContain('default_popup');
    expect(config).toContain("'127'");
    expect(config).toContain('externally_connectable');
    expect(config).toContain('web_accessible_resources');
  });
});
```

Run: `pnpm --filter @vital/extension test`
Expected: FAIL — config 无 `default_popup`、无 `'127'`。

- [ ] **Step 2: wxt.config.ts**

`apps/extension/wxt.config.ts` 的 `manifest()` 返回对象：

- `minimum_chrome_version: '116'` → `minimum_chrome_version: '127'`
- `web_accessible_resources` 的 resources 数组由 `['options.html']` → `['options.html', 'popup.html']`（Task 6 再移除 options.html）
- `action` 增加一行 `default_popup: 'popup.html',`（放在 `default_title` 之前）

- [ ] **Step 3: i18n.ts — 新增 popup 文案**

`copy` 对象追加（放在 `recent: '最近保存',` 之后）：

```ts
  popupLoading: '正在解析页面…',
  popupLoginHint: '在网页登录后，点工具栏即可把当前页收进来。快捷键 Alt+Shift+V。',
  popupLoginDone: '已登录。关闭此页，点工具栏图标开始收集。',
  popupModeArticle: '文章',
  popupModeSelection: '选区',
  popupModeTask: '待办',
  popupTitle: '标题',
  popupNote: '备注',
  popupList: '清单',
  popupSave: '保存',
  popupBack: '返回',
  popupRetry: '重试',
  popupCannotCapture: '无法收集此页，试试右键菜单或快捷键。',
  popupDone: '完成',
  popupLogout: '退出登录',
  popupEmpty: '还没有保存。',
```

- [ ] **Step 4: 创建 popup/index.html**

创建 `apps/extension/entrypoints/popup/index.html`（样式沿用 options 的暖色调调色板，popup 固定宽 340px）：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vital</title>
    <script type="module" src="./main.ts"></script>
    <style>
      :root {
        --bg: #fffbf5;
        --surface: #ffffff;
        --fg: #1c1914;
        --muted: #6b6358;
        --border: #eadfce;
        --accent: #e8a317;
        --accent-hover: #c4890f;
        --on-accent: #1c1914;
        --danger: #c45c6a;
        --font: system-ui, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #14110c;
          --surface: #1e1a14;
          --fg: #fff6ea;
          --muted: #a39888;
          --border: #3a3228;
          --accent: #f5c84b;
          --accent-hover: #e8a317;
          --on-accent: #1c1914;
          --danger: #e07a86;
        }
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        width: 340px;
        background: var(--bg);
        color: var(--fg);
        font: 14px/1.5 var(--font);
      }
      main {
        display: flex;
        flex-direction: column;
        min-height: 240px;
        max-height: 560px;
      }
      section {
        padding: 14px 16px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 16px;
        font-weight: 650;
      }
      .muted {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.45;
      }
      .center {
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: center;
      }
      label {
        display: block;
        font-size: 13px;
        color: var(--muted);
        margin: 10px 0 4px;
      }
      input,
      textarea,
      select {
        width: 100%;
        padding: 7px 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        color: var(--fg);
        font: inherit;
      }
      textarea {
        min-height: 64px;
        resize: vertical;
      }
      input:focus,
      textarea:focus,
      select:focus {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
      button {
        font: inherit;
        cursor: pointer;
        border-radius: 8px;
        border: 0;
      }
      button:disabled {
        cursor: default;
        opacity: 0.5;
      }
      .primary {
        padding: 9px 14px;
        background: var(--accent);
        color: var(--on-accent);
        font-weight: 600;
      }
      .primary:hover:not(:disabled) {
        background: var(--accent-hover);
      }
      .ghost {
        background: transparent;
        color: var(--accent);
        padding: 6px 0;
      }
      .modes {
        display: flex;
        gap: 6px;
      }
      .modes button {
        flex: 1;
        padding: 6px 0;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--surface);
        color: var(--muted);
        font-size: 13px;
      }
      .modes button.active {
        border-color: var(--accent);
        color: var(--fg);
        font-weight: 600;
      }
      .meta {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 12px;
      }
      .row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .saved-title {
        margin: 0 0 6px;
        font-weight: 650;
        font-size: 15px;
      }
      a.primary {
        display: inline-block;
        margin-top: 10px;
        text-decoration: none;
        text-align: center;
      }
      ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      li {
        border: 1px solid var(--border);
        background: var(--surface);
        border-radius: 10px;
        margin-bottom: 8px;
        padding: 8px 12px;
      }
      a.item {
        display: block;
        color: inherit;
        text-decoration: none;
      }
      a.item:hover .title {
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .title {
        font-weight: 600;
        font-size: 14px;
      }
      footer {
        display: flex;
        gap: 10px;
        align-items: center;
        padding: 10px 16px 14px;
        border-top: 1px solid var(--border);
      }
      footer .primary {
        flex: 1;
      }
      [hidden] {
        display: none !important;
      }
    </style>
  </head>
  <body>
    <main>
      <section id="view-loading" class="center">
        <p class="muted">正在解析页面…</p>
      </section>
      <section id="view-login" hidden>
        <h1>Vital</h1>
        <p class="muted">在网页登录后，点工具栏即可把当前页收进来。快捷键 Alt+Shift+V。</p>
        <button id="login-web" class="primary" type="button">在网页登录</button>
      </section>
      <section id="view-login-done" hidden>
        <h1>Vital</h1>
        <p class="muted">已登录。关闭此页，点工具栏图标开始收集。</p>
      </section>
      <section id="view-capture" hidden>
        <div class="modes" role="tablist" aria-label="保存模式">
          <button type="button" id="mode-article">文章</button>
          <button type="button" id="mode-selection">选区</button>
          <button type="button" id="mode-task">待办</button>
        </div>
        <label for="capture-title">标题</label>
        <input id="capture-title" maxlength="500" />
        <p id="capture-meta" class="meta"></p>
        <label for="capture-note">备注</label>
        <textarea id="capture-note" maxlength="500"></textarea>
        <div id="capture-list-wrap" hidden>
          <label for="capture-list">清单</label>
          <select id="capture-list"></select>
        </div>
      </section>
      <section id="view-saved" hidden>
        <p id="saved-title" class="saved-title"></p>
        <p id="saved-progress" class="meta" hidden></p>
        <a id="saved-open" class="primary" target="_blank" rel="noreferrer">打开</a>
        <button id="saved-done" class="ghost" type="button">完成</button>
      </section>
      <section id="view-error" hidden>
        <p id="error-message" class="muted"></p>
        <button id="error-retry" class="primary" type="button">重试</button>
      </section>
      <section id="view-recent" hidden>
        <div class="row">
          <h1>最近保存</h1>
          <button id="recent-back" class="ghost" type="button">返回</button>
        </div>
        <p id="recent-empty" class="muted" hidden>还没有保存。</p>
        <ul id="recent-items"></ul>
        <button id="logout" class="ghost" type="button">退出登录</button>
      </section>
      <footer id="footer" hidden>
        <button id="save" class="primary" type="button">保存</button>
        <button id="open-recent" class="ghost" type="button">最近保存</button>
      </footer>
    </main>
  </body>
</html>
```

（HTML 里的静态文案与 `copy` 的 popup keys 一一对应；动态文案在 main.ts 里用 `copy` 渲染，HTML 静态串是初始骨架。）

- [ ] **Step 5: 创建 popup/main.ts**

创建 `apps/extension/entrypoints/popup/main.ts`：

```ts
import type { InboxItem, List } from '@vital/dto';
import { inboxListUrl, inboxReaderUrl } from '../../src/capture-helpers.js';
import { WEB_URL } from '../../src/config.js';
import { copy } from '../../src/i18n.js';
import {
  COMMIT_PORT_NAME,
  type CapturePayload,
  type CommitPortEvent,
  type CommitPortMessage,
  type PanelRequest,
  type PanelResponse,
  type PopupMode,
} from '../../src/messages.js';
import {
  initialMode,
  metaLine,
  modeDisabled,
  progressLabel,
  savedLabel,
  titleForMode,
} from '../../src/popup-state.js';

type View = 'loading' | 'login' | 'login-done' | 'capture' | 'saved' | 'error' | 'recent';
const VIEWS: readonly View[] = [
  'loading',
  'login',
  'login-done',
  'capture',
  'saved',
  'error',
  'recent',
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function show(el: HTMLElement, visible: boolean): void {
  el.hidden = !visible;
}

async function rpc(req: PanelRequest): Promise<PanelResponse> {
  const res: unknown = await chrome.runtime.sendMessage(req);
  if (typeof res === 'object' && res !== null && 'ok' in res) {
    return res as PanelResponse;
  }
  return { ok: false, error: copy.toastFailed };
}

let capture: CapturePayload | null = null;
let mode: PopupMode = 'article';
let lists: List[] | null = null;
let savedKind: 'created' | 'existing' | 'task' = 'created';

function setView(view: View): void {
  for (const v of VIEWS) show($(`view-${v}`), v === view);
  show($('footer'), view === 'capture');
}

function renderCapture(): void {
  if (capture === null) return;
  for (const m of ['article', 'selection', 'task'] as const) {
    const btn = $(`mode-${m}`);
    btn.classList.toggle('active', m === mode);
    btn.disabled = modeDisabled(m, capture.selection);
  }
  $<HTMLInputElement>('capture-title').value = titleForMode(capture, mode);
  $('capture-meta').textContent = metaLine(capture, mode);
  show($('capture-list-wrap'), mode === 'task');
  if (mode === 'task' && lists === null) void loadLists();
}

async function loadLists(): Promise<void> {
  const res = await rpc({ type: 'lists' });
  lists = res.ok && 'lists' in res ? res.lists : [];
  const select = $<HTMLSelectElement>('capture-list');
  select.replaceChildren();
  for (const list of lists) {
    const opt = document.createElement('option');
    opt.value = list.id;
    opt.textContent = list.name;
    if (list.kind === 'inbox') opt.selected = true;
    select.append(opt);
  }
}

function commit(): void {
  if (capture === null) return;
  const message: CommitPortMessage = {
    type: 'commit-capture',
    capture,
    title: $<HTMLInputElement>('capture-title').value,
    note: $<HTMLTextAreaElement>('capture-note').value,
    mode,
    listId:
      mode === 'task' && $<HTMLSelectElement>('capture-list').value !== ''
        ? $<HTMLSelectElement>('capture-list').value
        : undefined,
  };
  $('save').disabled = true;
  const port = chrome.runtime.connect({ name: COMMIT_PORT_NAME });
  port.onMessage.addListener((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return;
    const ev = raw as CommitPortEvent;
    if (ev.type === 'created') {
      savedKind = ev.kind;
      $('saved-title').textContent = savedLabel(ev.kind, 0);
      $('saved-open').href =
        ev.kind === 'task' ? inboxListUrl(WEB_URL) : inboxReaderUrl(WEB_URL, ev.id);
      show($('saved-progress'), false);
      setView('saved');
      return;
    }
    if (ev.type === 'progress') {
      $('saved-progress').textContent = progressLabel(ev.done, ev.total);
      show($('saved-progress'), true);
      return;
    }
    if (ev.type === 'done') {
      $('saved-title').textContent = savedLabel(savedKind, ev.failed);
      show($('saved-progress'), false);
      return;
    }
    if (ev.type === 'error') {
      $('save').disabled = false;
      $('error-message').textContent = ev.message;
      setView('error');
    }
  });
  port.postMessage(message);
}

async function showRecent(): Promise<void> {
  setView('recent');
  const res = await rpc({ type: 'recent' });
  const items: InboxItem[] = res.ok && 'items' in res ? res.items : [];
  const ul = $('recent-items');
  ul.replaceChildren();
  show($('recent-empty'), items.length === 0);
  for (const item of items) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'item';
    a.href = inboxReaderUrl(WEB_URL, item.id);
    a.target = '_blank';
    a.rel = 'noreferrer';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = item.title;
    a.append(title);
    li.append(a);
    ul.append(li);
  }
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code !== null && code.length >= 20) {
    // Opened as a tab by the web login fallback: finish the handshake, then stop.
    history.replaceState({}, '', location.pathname);
    const res = await rpc({ type: 'exchange-code', code });
    setView(res.ok ? 'login-done' : 'login');
    return;
  }
  setView('loading');
  const session = await rpc({ type: 'session' });
  if (!session.ok || !('session' in session) || !session.session.loggedIn) {
    setView('login');
    return;
  }
  const cap = await rpc({ type: 'capture-active-tab' });
  if (!cap.ok || !('capture' in cap) || cap.capture === null) {
    $('error-message').textContent = copy.popupCannotCapture;
    setView('error');
    return;
  }
  capture = cap.capture;
  mode = initialMode(capture.selection);
  renderCapture();
  setView('capture');
}

for (const m of ['article', 'selection', 'task'] as const) {
  $(`mode-${m}`).addEventListener('click', () => {
    mode = m;
    renderCapture();
  });
}
$('save').addEventListener('click', commit);
$('open-recent').addEventListener('click', () => void showRecent());
$('recent-back').addEventListener('click', () => {
  if (capture === null) {
    $('error-message').textContent = copy.popupCannotCapture;
    setView('error');
    return;
  }
  setView('capture');
});
$('login-web').addEventListener('click', () => void rpc({ type: 'open-login' }));
$('logout').addEventListener('click', () => {
  void rpc({ type: 'logout' }).then(() => setView('login'));
});
$('error-retry').addEventListener('click', () => {
  $('save').disabled = false;
  setView('capture');
});
$('saved-done').addEventListener('click', () => window.close());
chrome.runtime.onMessage.addListener((message) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'session-changed'
  ) {
    void boot();
  }
});

void boot();
```

- [ ] **Step 6: Verify — 契约测试 + typecheck + 构建**

Run: `pnpm --filter @vital/extension test && pnpm --filter @vital/extension typecheck && pnpm --filter @vital/extension build`
Expected: 全部 PASS；`dist/chrome-mv3/manifest.json` 含 `"default_popup": "popup.html"` 与 `"minimum_chrome_version": "127"`。

- [ ] **Step 7: 人工冒烟（可选但推荐）**

Chrome `chrome://extensions` → 加载已解压 `apps/extension/dist/chrome-mv3` → 任意文章页点工具栏图标：弹窗出现、标题/元信息预填；选一段文字再点图标：「选区」模式自动激活；保存 → 成功态 + 「打开」链接；待办模式出现清单下拉。

- [ ] **Step 8: Commit**

```bash
git add apps/extension/entrypoints/popup apps/extension/wxt.config.ts apps/extension/src/i18n.ts apps/extension/__tests__/manifest.test.ts
git commit -m "feat(extension): Evernote-style toolbar popup for capture

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 清理旧面板与草稿机制 + web 回退改道 + spec 修订

删除 options entrypoint、`draft-store.ts`、草稿 RPC；web 登录回退 URL 从 `options.html` 改到 `popup.html`；更新 spec 中两处与实现不一致的表述。

**Files:**
- Delete: `apps/extension/entrypoints/options/`（整个目录）
- Delete: `apps/extension/src/draft-store.ts`
- Modify: `apps/extension/src/messages.ts`（删 `CaptureDraft` + 3 个草稿 RPC）
- Modify: `apps/extension/src/client.ts`（删对应 case）
- Modify: `apps/extension/src/capture.ts`（删 `commitDraft`）
- Modify: `apps/extension/src/i18n.ts`（删死键）
- Modify: `apps/extension/wxt.config.ts`（web_accessible_resources 移除 options.html）
- Modify: `apps/web/src/pages/extension-auth.tsx:69`（fallback URL）
- Modify: `docs/superpowers/specs/2026-09-08-extension-popup-capture-design.md`（修订）

**Interfaces:**
- Consumes: `popup.html`（Task 5）。
- Produces: 无（终点任务）。

- [ ] **Step 1: 删除文件**

```bash
git rm -r apps/extension/entrypoints/options
git rm apps/extension/src/draft-store.ts
```

- [ ] **Step 2: messages.ts — 删除草稿协议**

- 删除 `CaptureDraft` 接口（`CapturePayload` 已取代）。
- `PanelRequest` 删除 `| { type: 'load-draft' }`、`| { type: 'clear-draft' }` 和整个 `commit-draft` 分支。
- `PanelResponse` 删除 `| { ok: true; draft: CaptureDraft | null }`。
- `isPanelRequest` 删除 `value.type === 'load-draft' ||`、`value.type === 'clear-draft' ||`、`value.type === 'commit-draft' ||` 三行。

- [ ] **Step 3: client.ts — 删除对应 case**

`handlePanelMessage` 删除 `case 'load-draft'`、`case 'clear-draft'`、`case 'commit-draft'` 三个分支。`CaptureDraft` 的 type import 若不再使用一并删除。

- [ ] **Step 4: capture.ts — 删除 commitDraft**

删除整个 `commitDraft` 函数（`export async function commitDraft(...)` 到其闭合 `}`）。确认 `draft-store` 不再被引用：`grep -n "draft" apps/extension/src/capture.ts` 应无结果。

- [ ] **Step 5: i18n.ts — 删除死键**

先 grep 确认每个候选键在 `apps/extension`（排除 `i18n.ts` 自身与 `__tests__`）无引用，然后从 `copy` 删除：

```bash
grep -rn "editTitle\|editNote\|editModeInbox\|editModeTask\|editList\|editSave\|editCancel\|copy.email\|copy.password\|copy.popupEmpty" apps/extension/src apps/extension/entrypoints --include="*.ts" | grep -v i18n.ts
```

输出为空则删除键：`editTitle`、`editNote`、`editModeInbox`、`editModeTask`、`editList`、`editSave`、`editCancel`、`email`、`password`。（`popupEmpty` 若无引用也删。）

- [ ] **Step 6: wxt.config.ts — 收紧 web_accessible_resources**

`web_accessible_resources` 的 resources 由 `['options.html', 'popup.html']` → `['popup.html']`。

- [ ] **Step 7: web 登录回退改道**

`apps/web/src/pages/extension-auth.tsx:69`：

```ts
        window.location.assign(
          `chrome-extension://${extensionId}/popup.html?code=${encodeURIComponent(issued.code)}`,
        );
```

（popup 的 `?code=` 处理已在 Task 5 Step 5 实现。）

- [ ] **Step 8: spec 修订**

`docs/superpowers/specs/2026-09-08-extension-popup-capture-design.md`：

1. 「RPC 协议」一节，把「删除 `load-draft` / `clear-draft` / `commit-draft` / `exchange-code`（授权统一走网页流）」改为「删除 `load-draft` / `clear-draft` / `commit-draft`；**保留 `exchange-code`**（popup 以标签页打开时的 `?code=` 登录回退路径）」。
2. 「风险与权衡」一节 popup 生命周期条目，把「进度反馈退化为 badge」确认措辞为「popup 关闭后 background 继续完成转存，进度反馈退化为工具栏 badge（`setBadge`），数据不丢」。

- [ ] **Step 9: Verify — 全量**

```bash
pnpm --filter @vital/extension test && pnpm --filter @vital/extension typecheck && pnpm --filter @vital/extension lint && pnpm --filter @vital/extension build
pnpm --filter @vital/web test
```

Expected: 全部 PASS。构建产物 manifest 中不再有 `options_page` / `options_ui`。

- [ ] **Step 10: Commit**

```bash
git add apps/extension/entrypoints/options apps/extension/src/draft-store.ts apps/extension/src/messages.ts apps/extension/src/client.ts apps/extension/src/capture.ts apps/extension/src/i18n.ts apps/extension/wxt.config.ts apps/web/src/pages/extension-auth.tsx docs/superpowers/specs/2026-09-08-extension-popup-capture-design.md
git commit -m "refactor(extension): drop legacy panel, draft store; web login fallback to popup

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review 结论

- **Spec 覆盖**：交互模型变更表（弹窗/快捷键保留/右键直存保留/编辑入口改道/最近保存入弹窗/未登录引导）→ Task 4、5；三模式与预填 → Task 2、3、5；进度条 → Task 4 Port + Task 5 渲染；popup 误关 → Task 4 badge 回退；manifest 契约反转与 Chrome 127 → Task 5；删除清单 → Task 6；web 回退 → Task 6 Step 7。无缺口。
- **占位符扫描**：无 TBD/「适当处理」类步骤；所有代码步骤给出完整代码。
- **类型一致性**：`CapturePayload`/`PopupMode`/`CommitPortMessage`/`CommitPortEvent` 在 Task 1 定义，Task 2-5 引用一致；`commitCapture` 返回 `CommitResult`，background 监听器解构 `{ failed }` 一致；`savedLabel(kind, failed)` 与 Task 3 测试一致。
