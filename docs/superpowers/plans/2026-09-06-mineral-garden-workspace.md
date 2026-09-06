# Mineral Garden Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Vital’s visual language and desktop shell as a Mineral Garden personal workspace while preserving every existing task, reading, report, routing, and data behavior.

**Architecture:** Retheme `@vital/tokens` first, retaining compatibility aliases while semantic token names migrate. Then change the shell into Rail + Library + constrained Focus Canvas + on-demand Detail. Each feature workspace adopts the shell and density rules without altering its data queries, DTOs, routes, keyboard actions, or mutations.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vitest, Testing Library, Lucide, `@vital/tokens` CSS custom properties.

**Spec:** `docs/vital-calm-productivity-design-system.md`

## Global Constraints

- Use the Mineral Garden palette exactly: Light `#F3F3ED/#FAFAF6/#EAECE4`, Dark `#191C19/#20231F/#292D27`, sage `#697C65`, light deep accent `#425246`, dark accent `#A0B497`.
- Keep all task, inbox, report, auth, route, API, and keyboard behavior unchanged; this plan is visual/layout-only.
- Components use semantic CSS variables; do not add component-local hex color values.
- Preserve WCAG AA contrast, visible keyboard focus, and `prefers-reduced-motion` support.
- Keep ordinary tasks, reading items, and report rows as information rows, not cards. Use cards only where the spec explicitly allows one.
- Do not alter the user’s existing unrelated working-tree changes.

---

## File map

| File | Responsibility |
|---|---|
| `packages/tokens/src/theme.ts` | Typed light/dark color and sizing source of truth |
| `packages/tokens/src/css/semantic.css` | Runtime semantic CSS variables and theme overrides |
| `packages/tokens/__tests__/theme/theme.test.ts` | Palette and shared-token regression contract |
| `apps/web/src/styles/app.css` | Tailwind semantic-variable bridge; global Focus Canvas and reader rules |
| `apps/web/src/shell/chrome.ts` | Persisted and clamped Library/Rail geometry |
| `apps/web/src/shell/Shell.tsx` | Rail, Library placement, responsive shell container |
| `apps/web/src/shell/SecondaryPane.tsx` | Library presentation, resize affordance, current-path navigation |
| `apps/web/src/shell/rail-nav.ts` | Shared Library item geometry and selected treatment |
| `apps/web/__tests__/shell/{chrome,rail-nav}.test.ts` | Shell geometry and selected-state contracts |
| `apps/web/src/features/todos/{TodosWorkspace,QuickAdd,TaskRow,TaskDetail}.tsx` | Constrained Today Canvas, low-chrome task rows, on-demand detail |
| `apps/web/__tests__/features/todos/todos.test.tsx` | Todo semantic and detail-presence regression coverage |
| `apps/web/src/features/inbox/{InboxWorkspace,InboxReader,InboxRow,EmptyInbox}.tsx` | Reading queue and dedicated reading canvas |
| `apps/web/__tests__/features/inbox/inbox.test.tsx` | Inbox/reader behavior and layout hooks |
| `apps/web/src/features/reports/{ReportsWorkspace,Overview,StreakCalendar}.tsx` | Editorial reflection canvas with contextual calendar |
| `apps/web/__tests__/features/reports/reports.test.tsx` | Report navigation/editor regression coverage |

## Task 1: Establish Mineral Garden semantic tokens

**Files:**

- Create: `packages/tokens/__tests__/theme/theme.test.ts`
- Modify: `packages/tokens/src/theme.ts`
- Modify: `packages/tokens/src/css/semantic.css`
- Modify: `apps/web/src/styles/app.css`

**Interfaces:**

- Consumes: the existing `ColorTokens`, `lightColors`, `darkColors`, `sharedTokens`, and CSS variable contract.
- Produces: `bgElevated`, `textSecondary`, `textTertiary`, `accentDeep`, and `focusRing` in the TypeScript token contract; equivalent `--bg-elevated`, `--text-secondary`, `--text-tertiary`, `--accent-deep`, and `--focus-ring` variables.

- [ ] **Step 1: Write the failing token contract test.**

  Create `packages/tokens/__tests__/theme/theme.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { darkColors, lightColors, sharedTokens } from '../../src/theme';

  describe('Mineral Garden tokens', () => {
    it('uses the limestone and sage light palette', () => {
      expect(lightColors.bgCanvas).toBe('#F3F3ED');
      expect(lightColors.accentPrimary).toBe('#697C65');
      expect(lightColors.accentDeep).toBe('#425246');
    });

    it('keeps dark mode plant-grey instead of neutral black', () => {
      expect(darkColors.bgCanvas).toBe('#191C19');
      expect(darkColors.bgSurface).toBe('#20231F');
      expect(darkColors.accentPrimary).toBe('#A0B497');
    });

    it('uses the compact control and radius scale', () => {
      expect(sharedTokens.radius).toMatchObject({ sm: 6, md: 8, lg: 12, xl: 16 });
      expect(sharedTokens.controlH).toBe(36);
      expect(sharedTokens.controlHProminent).toBe(40);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `pnpm --filter @vital/tokens test -- theme/theme.test.ts`

  Expected: FAIL because `accentDeep` and the expected palette/scale do not exist yet.

- [ ] **Step 3: Implement typed and CSS semantic tokens.**

  Extend `ColorTokens` with the five produced names. Set the exact palette from the spec in `lightColors` and `darkColors`; preserve existing legacy names (`bgCanvas`, `fgPrimary`, `fgMuted`, `accentPrimary`) as aliases during this migration. In `semantic.css`, define the new variables in both roots and map legacy variables to their equivalent values. Update `app.css` so Tailwind exposes `bg-elevated`, `text-secondary`, `text-tertiary`, `accent-deep`, and a focus shadow token.

  The resulting light core must include:

  ```css
  --bg-app: #f3f3ed;
  --bg-surface: #fafaf6;
  --bg-surface-muted: #eaece4;
  --accent-primary: #697c65;
  --accent-deep: #425246;
  --bg-accent-subtle: #dce3d7;
  --text-primary: #272b27;
  ```

- [ ] **Step 4: Implement the shared sizing and type adjustments.**

  Set `radius` to `{ sm: 6, md: 8, lg: 12, xl: 16, pill: 999 }`, `controlH: 36`, `controlHProminent: 40`, and `fieldH: 40` in `sharedTokens`; emit matching CSS variables. Use `Inter` before PingFang in the web font stack, retaining all system fallbacks.

- [ ] **Step 5: Run token checks.**

  Run: `pnpm --filter @vital/tokens test -- theme/theme.test.ts && pnpm --filter @vital/tokens typecheck && pnpm --filter @vital/tokens lint`

  Expected: PASS.

- [ ] **Step 6: Commit the token foundation.**

  ```bash
  git add packages/tokens/src/theme.ts packages/tokens/src/css/semantic.css packages/tokens/__tests__/theme/theme.test.ts apps/web/src/styles/app.css
  git commit -m "feat: add mineral garden semantic tokens"
  ```

## Task 2: Convert the application shell into Rail, Library, Canvas, and on-demand Detail

**Files:**

- Modify: `apps/web/src/shell/chrome.ts`
- Modify: `apps/web/src/shell/Shell.tsx`
- Modify: `apps/web/src/shell/SecondaryPane.tsx`
- Modify: `apps/web/src/shell/rail-nav.ts`
- Modify: `apps/web/__tests__/shell/chrome.test.ts`
- Modify: `apps/web/__tests__/shell/rail-nav.test.ts`

**Interfaces:**

- Consumes: semantic token classes from Task 1 and existing `loadPaneWidth` / `savePaneWidth` persistence.
- Produces: `LIBRARY_MIN = 224`, `LIBRARY_MAX = 264`, `LIBRARY_DEFAULT = 248`; Shell landmark `data-layout="mineral-garden"`; Library landmark `data-region="library"`.

- [ ] **Step 1: Write failing geometry and nav-class tests.**

  Add to `chrome.test.ts`:

  ```ts
  import { LIBRARY_DEFAULT, LIBRARY_MAX, LIBRARY_MIN } from '../../src/shell/chrome';

  it('uses the Mineral Garden library range', () => {
    expect(LIBRARY_MIN).toBe(224);
    expect(LIBRARY_DEFAULT).toBe(248);
    expect(LIBRARY_MAX).toBe(264);
    expect(clampPaneWidth(0)).toBe(LIBRARY_MIN);
  });
  ```

  Replace the selected-state assertion in `rail-nav.test.ts` with:

  ```ts
  expect(railNavClass(true)).toContain('rounded-md');
  expect(railNavClass(true)).toContain('bg-accent-subtle');
  expect(railNavClass(true)).toContain('before:bg-accent');
  ```

- [ ] **Step 2: Run the tests to verify they fail.**

  Run: `pnpm --filter @vital/web test -- shell/chrome.test.ts shell/rail-nav.test.ts`

  Expected: FAIL because the old 196–420px pane range and square nav treatment are still present.

- [ ] **Step 3: Implement fixed Rail and bounded Library geometry.**

  In `chrome.ts`, rename pane constants to the produced `LIBRARY_*` exports and update all callers; retain persisted key `vital:pane-width` so existing users keep their preference after clamping. Keep Rail at 56px in its compact desktop state; remove the 152px expanded product navigation behavior so Rail remains a book-spine icon rail.

- [ ] **Step 4: Implement the new shell landmarks and visual hierarchy.**

  In `Shell.tsx`, use `data-layout="mineral-garden"` on the root, `data-region="rail"` on the first aside, and a Canvas wrapper around `main`. Rail controls are 36px / `rounded-md`; change New to a compact icon-only button with an accessible label. In `SecondaryPane.tsx`, add `data-region="library"`, move its background to `bg-surface`, remove the permanent visible right border, and make the resize hit area only reveal a 1px accent indicator on hover/focus.

- [ ] **Step 5: Implement current-path Library treatment.**

  Make `railNavClass(true)` return `rounded-md bg-accent-subtle text-fg` with the existing 2px left accent marker. Inactive items remain transparent, use `text-muted`, and only obtain `bg-surface-muted` on hover. Do not change link destinations, icons, or section selection logic.

- [ ] **Step 6: Add responsive behavior in CSS.**

  In `app.css`, make Canvas use `min-width: 0` and add `@media (max-width: 1023px)` rules that turn Library into a translated sheet rather than consuming Canvas width. Do not make a mobile router change in this task; preserve the currently available navigation controls and ensure the rules only change visual placement.

- [ ] **Step 7: Run shell checks.**

  Run: `pnpm --filter @vital/web test -- shell/chrome.test.ts shell/rail-nav.test.ts && pnpm --filter @vital/web typecheck && pnpm --filter @vital/web lint`

  Expected: PASS.

- [ ] **Step 8: Commit the shell.**

  ```bash
  git add apps/web/src/shell/chrome.ts apps/web/src/shell/Shell.tsx apps/web/src/shell/SecondaryPane.tsx apps/web/src/shell/rail-nav.ts apps/web/src/styles/app.css apps/web/__tests__/shell/chrome.test.ts apps/web/__tests__/shell/rail-nav.test.ts
  git commit -m "feat: reshape shell as mineral garden workspace"
  ```

## Task 3: Rebuild the Today and list experience as a constrained execution canvas

**Files:**

- Modify: `apps/web/src/features/todos/TodosWorkspace.tsx`
- Modify: `apps/web/src/features/todos/QuickAdd.tsx`
- Modify: `apps/web/src/features/todos/TaskRow.tsx`
- Modify: `apps/web/src/features/todos/TaskDetail.tsx`
- Modify: `apps/web/__tests__/features/todos/todos.test.tsx`

**Interfaces:**

- Consumes: Shell Canvas from Task 2; `useTodosUi().detailOpen` and existing task callbacks.
- Produces: `data-region="focus-canvas"` on the todo workspace and `data-density="task-row"` on each ordinary row; no empty detail `<aside>` when `detailOpen` is false.

- [ ] **Step 1: Write the failing workspace assertions.**

  Add to `todos.test.tsx`:

  ```ts
  it('keeps today in a focus canvas and does not reserve an empty detail pane', async () => {
    renderAt('/todos/lists/smart:today');
    expect(await screen.findByRole('main')).toHaveAttribute('data-region', 'focus-canvas');
    expect(screen.queryByLabelText(t.todos.pickTask)).not.toBeInTheDocument();
  });
  ```

  Add a task fixture and assert its row has `data-density="task-row"` after it renders.

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `pnpm --filter @vital/web test -- features/todos/todos.test.tsx`

  Expected: FAIL because the Focus Canvas hook and conditional detail absence are not implemented.

- [ ] **Step 3: Implement Focus Canvas header and controlled content widths.**

  In `TodosWorkspace.tsx`, make the content container a semantic `main` with `data-region="focus-canvas"`; use `max-w-[57.5rem]` for list content while leaving board/calendar allowed to fill Canvas. Use a `12px` kicker for date/context, a `24px` page title, 36px view controls, and 40px filter input. Keep existing view routes and filter IDs.

- [ ] **Step 4: Replace heavy task chrome with information rows.**

  In `QuickAdd.tsx`, change the input to 40px, `rounded-md`, `bg-surface-muted`, no default shadow, and 3px focus ring. In `TaskRow.tsx`, use `min-h-[44px]`, `rounded-md`, `px-3 py-2`, `gap-3`, and only apply its background on hover/selection. Make tags 6px radius, 12px metadata, and show no full-row status color. Keep all drag, click, double-click, checkbox, priority, and ARIA behavior unchanged.

- [ ] **Step 5: Make Detail truly on-demand.**

  Remove the fallback `aside` that currently displays `t.todos.pickTask`; render `TaskDetail` only when both `detailOpen` and `detailTask` are truthy. Update `TaskDetail.tsx` to use a 400px max-width overlay/pane class that does not force Canvas shrinkage until present. Preserve the existing close control and all mutations.

- [ ] **Step 6: Run todo regression checks.**

  Run: `pnpm --filter @vital/web test -- features/todos/todos.test.tsx features/todos/keyboard.test.ts && pnpm --filter @vital/web typecheck`

  Expected: PASS.

- [ ] **Step 7: Commit the todo canvas.**

  ```bash
  git add apps/web/src/features/todos/TodosWorkspace.tsx apps/web/src/features/todos/QuickAdd.tsx apps/web/src/features/todos/TaskRow.tsx apps/web/src/features/todos/TaskDetail.tsx apps/web/__tests__/features/todos/todos.test.tsx
  git commit -m "feat: refine today as focus canvas"
  ```

## Task 4: Apply Library and Focus Canvas patterns to later reading

**Files:**

- Modify: `apps/web/src/shell/CapturePane.tsx`
- Modify: `apps/web/src/features/inbox/InboxWorkspace.tsx`
- Modify: `apps/web/src/features/inbox/InboxRow.tsx`
- Modify: `apps/web/src/features/inbox/InboxReader.tsx`
- Modify: `apps/web/src/features/inbox/EmptyInbox.tsx`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/__tests__/features/inbox/inbox.test.tsx`

**Interfaces:**

- Consumes: Library from Task 2, the existing inbox item selection state, and `reader-article` styles.
- Produces: `data-region="reading-canvas"` on inbox workspace and `data-density="reading-row"` on reading-list items.

- [ ] **Step 1: Write failing reading layout tests.**

  Add to `inbox.test.tsx`:

  ```ts
  it('marks the selected reader as a constrained reading canvas', async () => {
    renderAt('/inbox');
    expect(await screen.findByRole('main')).toHaveAttribute('data-region', 'reading-canvas');
  });
  ```

  In the existing row rendering test, assert the selected item’s closest row has `data-density="reading-row"`.

- [ ] **Step 2: Run the inbox tests to verify failure.**

  Run: `pnpm --filter @vital/web test -- features/inbox/inbox.test.tsx`

  Expected: FAIL because neither layout hook exists.

- [ ] **Step 3: Implement the quieter capture Library.**

  In `CapturePane.tsx`, keep URL preview and extension actions exactly as they work now. Restyle Preview as the sole 40px Primary action; render install-extension and paste-link as quiet/secondary actions. Add reading state counts only where the existing API already supplies them; do not add a query merely for decoration.

- [ ] **Step 4: Implement the queue and reading Canvas.**

  In `InboxWorkspace.tsx`, use semantic `main data-region="reading-canvas"` rather than centered full-viewport empty content. Make `InboxRow.tsx` a 44–64px information row with an optional fixed 40px thumbnail/fallback favicon, two-line title clamp, and 12px source/time metadata. In `InboxReader.tsx` and `app.css`, cap the readable body column at 700px, use `16px/28px` body text, and add a 2px `accent-primary` progress indicator; retain the sanitization and text-size behavior.

- [ ] **Step 5: Restrict Mineral Garden imagery to empty and onboarding states.**

  Add a presentational `data-vignette="mineral-garden"` wrapper only to `EmptyInbox.tsx`. It must be hidden from screen readers, be removable by `prefers-reduced-motion`, and never appear beside a populated reading queue or article.

- [ ] **Step 6: Run inbox regression checks.**

  Run: `pnpm --filter @vital/web test -- features/inbox/inbox.test.tsx features/inbox/purify.test.ts && pnpm --filter @vital/web typecheck`

  Expected: PASS.

- [ ] **Step 7: Commit the reading experience.**

  ```bash
  git add apps/web/src/shell/CapturePane.tsx apps/web/src/features/inbox apps/web/src/styles/app.css apps/web/__tests__/features/inbox/inbox.test.tsx
  git commit -m "feat: apply mineral garden reading canvas"
  ```

## Task 5: Reframe reports as an editorial reflection canvas

**Files:**

- Modify: `apps/web/src/features/reports/ReportsWorkspace.tsx`
- Modify: `apps/web/src/features/reports/Overview.tsx`
- Modify: `apps/web/src/features/reports/StreakCalendar.tsx`
- Modify: `apps/web/src/features/reports/ReviewLists.tsx`
- Modify: `apps/web/__tests__/features/reports/reports.test.tsx`

**Interfaces:**

- Consumes: the existing `ReportsWorkspace` session and save state, current report routes, `ReviewLists`, and `StreakCalendar`.
- Produces: `data-region="reflection-canvas"` on the report main region, `data-context="calendar"` on the small calendar navigation surface.

- [ ] **Step 1: Write the failing report layout test.**

  Add to `reports.test.tsx`:

  ```ts
  it('keeps the report editor as the primary reflection canvas', async () => {
    renderAt('/reports');
    expect(await screen.findByRole('main')).toHaveAttribute('data-region', 'reflection-canvas');
    expect(document.querySelector('[data-context="calendar"]')).not.toBeNull();
  });
  ```

- [ ] **Step 2: Run the test to verify it fails.**

  Run: `pnpm --filter @vital/web test -- features/reports/reports.test.tsx`

  Expected: FAIL because the report Canvas and contextual-calendar hooks do not exist.

- [ ] **Step 3: Implement editorial report hierarchy.**

  In `ReportsWorkspace.tsx`, render the editor-facing main region with `data-region="reflection-canvas"`, `max-w-[45rem]` content column, a 24px date/title, and a single metadata line (`完成 · 写下 · 结转`) before the writing area. Do not modify the save/session state machine or report hydration.

- [ ] **Step 4: Demote dashboard chrome without losing metrics.**

  In `Overview.tsx`, replace large metric-card presentation with compact inline metrics and a 12px contextual label. In `StreakCalendar.tsx`, give only the calendar container `data-context="calendar"`, a 12px radius, and a Mineral Garden four-step `accent.subtle → accent.primary` fill scale. In `ReviewLists.tsx`, keep list actions in hover/keyboard focus state rather than showing large persistent buttons.

- [ ] **Step 5: Run report regression checks.**

  Run: `pnpm --filter @vital/web test -- features/reports/reports.test.tsx features/reports/model.test.ts && pnpm --filter @vital/web typecheck`

  Expected: PASS.

- [ ] **Step 6: Commit the reflection canvas.**

  ```bash
  git add apps/web/src/features/reports apps/web/__tests__/features/reports/reports.test.tsx
  git commit -m "feat: make reports an editorial reflection canvas"
  ```

## Task 6: Accessibility, responsive, and visual regression verification

**Files:**

- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/__tests__/shell/chrome.test.ts`
- Modify: `apps/web/__tests__/features/todos/todos.test.tsx`
- Modify: `docs/vital-calm-productivity-design-system.md`

**Interfaces:**

- Consumes: all prior task layout hooks and semantic tokens.
- Produces: tested layout landmarks, documented breakpoint behavior, and no remaining default `rounded-2xl` treatment in the Shell / primary task / reading / report paths.

- [ ] **Step 1: Write the failing accessibility and responsive contract tests.**

  Add assertions that the shell’s main landmark remains reachable after rendering a todo route and that the task quick-add input has a focus class using `shadow-[0_0_0_3px_var(--focus-ring)]`. Add a shell test that asserts the Library resize clamp never exceeds 264px.

- [ ] **Step 2: Run the targeted tests to verify failure.**

  Run: `pnpm --filter @vital/web test -- shell/chrome.test.ts features/todos/todos.test.tsx`

  Expected: FAIL until focus ring and final clamp contracts are present.

- [ ] **Step 3: Implement final responsive and reduced-motion rules.**

  In `app.css`, add explicit Canvas padding at the four spec breakpoints, cap article/report/list widths, and ensure Library/Detail sheets use `transform` plus the standard 180ms easing. In the existing reduced-motion block, reduce those transitions to 1ms. Keep `:focus-visible` outline and add the semantic 3px focus shadow for text-entry controls.

- [ ] **Step 4: Run non-mutating visual audit with CSI.**

  Open these routes in one browser group and save screenshots at 1440px and a narrow desktop viewport: `/todos/lists/smart:today`, `/inbox`, `/reports`. Verify: one visual primary action per local area; no empty Detail pane on Today; Library does not use hard border separation; main text remains within specified Canvas widths; dark mode surfaces are plant-grey rather than neutral black.

- [ ] **Step 5: Run the complete automated suite.**

  Run: `pnpm --filter @vital/tokens test && pnpm --filter @vital/web test && pnpm --filter @vital/tokens typecheck && pnpm --filter @vital/web typecheck && pnpm --filter @vital/tokens lint && pnpm --filter @vital/web lint`

  Expected: PASS.

- [ ] **Step 6: Update the specification’s implementation status and commit.**

  Mark the completed phases in `docs/vital-calm-productivity-design-system.md` with their verified test command/date; do not change visual decisions in this step.

  ```bash
  git add apps/web/src/styles/app.css apps/web/__tests__/shell/chrome.test.ts apps/web/__tests__/features/todos/todos.test.tsx docs/vital-calm-productivity-design-system.md
  git commit -m "test: verify mineral garden workspace accessibility"
  ```
