# Task Reminders and Fixed Recurrence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support preset and custom task reminders plus fixed daily, weekly, monthly, yearly, weekday, weekend, holiday, and legal-workday recurrence.

**Architecture:** Task DTOs and the database gain explicit reminder and recurrence semantics while retaining legacy `remindAt` and RRULE values for compatibility. The server owns holiday evaluation, next-instance calculation, and notification outbox scheduling; the Web client exposes the values through two shared, low-contrast task-detail controls.

**Tech Stack:** TypeScript, Fastify, Drizzle/PostgreSQL, Luxon, Vitest, React, React Query, Tailwind utilities.

**Spec:** `docs/superpowers/specs/2026-09-07-task-reminders-and-recurrence-design.md`

## Global Constraints

- Use the existing direct `vital_test` test environment; do not use Docker or Compose.
- Keep server-generated notification schedules and calendar evaluation on the server; the Web client must not infer legal holidays.
- Reuse `DateField`, `TimeField`, and `DateTimeField` for all date/time input.
- Maintain legacy `remindAt` and `recurrence` fields in API responses for old clients.
- Keep task-detail controls borderless and low contrast; use the shared focus ring only on focus.
- Run a red-green test cycle for every task and commit each independently testable deliverable.

---

## File Structure

- `packages/dto/src/tasks.ts` — semantic reminder/recurrence types, task fields, API input validation.
- `apps/server/drizzle/0007_task_reminder_recurrence.sql` — new task columns, holiday-calendar table, legacy backfill.
- `apps/server/src/db/schema/tasks.ts` and `apps/server/src/db/schema/holiday-calendar.ts` — Drizzle schema.
- `apps/server/src/holidays/china-calendar.ts` — versioned China holiday lookup and unpublished-year fallback.
- `apps/server/src/tasks/recurrence.ts` — fixed recurrence kind parsing and next valid occurrence calculation.
- `apps/server/src/notifications/schedule.ts` and `apps/server/src/notifications/outbox.ts` — occurrence-aware reminder planning and cancellation/requeue.
- `apps/server/src/tasks/tasks.service.ts` — DTO mapping, validation, persistence, and outbox synchronization.
- `apps/web/src/features/todos/ReminderPicker.tsx` and `RecurrencePicker.tsx` — focused UI controls.
- `apps/web/src/features/todos/TaskDetail.tsx`, `TaskRow.tsx`, and `model.ts` — task editing and concise list summaries.
- `apps/*/__tests__` — unit, component, flow, and regression coverage.

### Task 1: Define task reminder and recurrence contracts

**Files:**
- Modify: `packages/dto/src/tasks.ts`
- Test: `packages/dto/src/tasks.test.ts` (create if absent)

**Consumes:** existing `Task`, `createTaskInputSchema`, and `patchTaskInputSchema`.

**Produces:**
```ts
export const reminderModeSchema = z.enum(['none', 'due', 'offset', 'custom']);
export const recurrenceKindSchema = z.enum([
  'daily', 'weekly', 'monthly', 'yearly', 'weekdays', 'weekends', 'holidays', 'legal_workdays',
]);
export type ReminderMode = z.infer<typeof reminderModeSchema>;
export type RecurrenceKind = z.infer<typeof recurrenceKindSchema> | null;
```

- [ ] **Step 1: Write the failing DTO tests**

```ts
it('accepts an offset reminder and legal-workday recurrence', () => {
  expect(createTaskInputSchema.parse({
    title: '发送周报', listId: ID, reminderMode: 'offset', reminderOffsetMinutes: 15,
    recurrenceKind: 'legal_workdays',
  }).reminderOffsetMinutes).toBe(15);
});

it('rejects an unsupported reminder offset', () => {
  expect(() => createTaskInputSchema.parse({ title: 'x', listId: ID, reminderMode: 'offset', reminderOffsetMinutes: 10 })).toThrow();
});
```

- [ ] **Step 2: Run the DTO test and verify it fails**

Run: `pnpm --filter @vital/dto test -- tasks`

Expected: FAIL because the semantic fields do not exist in the schema.

- [ ] **Step 3: Add the minimal semantic contract**

Add nullable `reminderMode`, `reminderOffsetMinutes`, `reminderAt`, and `recurrenceKind` to `Task`; accept the same fields on create and patch. Enforce: offset mode permits only `5 | 15 | 30 | 60 | 1440`; custom mode accepts only an ISO date time; none/due reject both payload values.

- [ ] **Step 4: Run the DTO test and build**

Run: `pnpm --filter @vital/dto test -- tasks && pnpm --filter @vital/dto build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dto/src/tasks.ts packages/dto/src/tasks.test.ts
git commit -m "feat: define task reminder and recurrence contracts"
```

### Task 2: Persist semantics and holiday calendar records

**Files:**
- Create: `apps/server/drizzle/0007_task_reminder_recurrence.sql`
- Modify: `apps/server/drizzle/meta/_journal.json`
- Modify: `apps/server/src/db/schema/tasks.ts`
- Create: `apps/server/src/db/schema/holiday-calendar.ts`
- Modify: `apps/server/src/db/schema/index.ts`
- Test: `apps/server/__tests__/helpers/db.ts`

**Consumes:** Task contracts from Task 1.

**Produces:** `holidayCalendar` table with `date`, `kind` (`holiday | workday`), `region` (`CN`), `sourceVersion`, and uniqueness on `(region, date)`; nullable semantic task columns.

- [ ] **Step 1: Write a failing migration/schema test**

```ts
it('stores a legal workday and semantic reminder fields', async () => {
  await db.insert(holidayCalendar).values({ date: '2026-02-22', region: 'CN', kind: 'workday', sourceVersion: '2026.1' });
  const [task] = await db.insert(tasks).values(taskRow({ reminderMode: 'offset', reminderOffsetMinutes: 15, recurrenceKind: 'legal_workdays' })).returning();
  expect(task.recurrenceKind).toBe('legal_workdays');
});
```

- [ ] **Step 2: Run the server test and verify it fails**

Run: `pnpm --filter @vital/server exec vitest run __tests__/helpers/db.test.ts`

Expected: FAIL because the schema/table does not exist.

- [ ] **Step 3: Add migration and Drizzle schema**

Create the new columns with check constraints matching Task 1. Backfill non-null historical `remind_at` as `custom` and basic historical RRULE values as their equivalent fixed kind. Preserve unrepresentable RRULEs with null `recurrence_kind`. Add `holiday_calendar` and register its schema export.

- [ ] **Step 4: Apply migration and run test against direct test DB**

Run: `pnpm --filter @vital/server migrate && pnpm --filter @vital/server exec vitest run __tests__/helpers/db.test.ts`

Expected: migration applies and test PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/drizzle apps/server/src/db/schema apps/server/__tests__/helpers/db.ts
git commit -m "feat: persist task reminder recurrence and holiday data"
```

### Task 3: Implement China holiday evaluation

**Files:**
- Create: `apps/server/src/holidays/china-calendar.ts`
- Create: `apps/server/__tests__/holidays/china-calendar.test.ts`

**Consumes:** `holidayCalendar` from Task 2.

**Produces:**
```ts
export type ChinaDayKind = 'holiday' | 'workday' | 'weekday_fallback';
export async function chinaDayKind(date: string, db?: HolidayDb): Promise<ChinaDayKind>;
export async function matchesChinaRule(date: string, rule: 'holidays' | 'legal_workdays', db?: HolidayDb): Promise<boolean>;
```

- [ ] **Step 1: Write failing calendar tests**

```ts
it('treats an explicit statutory holiday as a holiday', async () => {
  await seed('2026-10-01', 'holiday');
  await expect(matchesChinaRule('2026-10-01', 'holidays')).resolves.toBe(true);
});
it('treats an explicit make-up Saturday as a legal workday', async () => {
  await seed('2026-02-21', 'workday');
  await expect(matchesChinaRule('2026-02-21', 'legal_workdays')).resolves.toBe(true);
});
it('falls back to Monday through Friday for an unpublished year', async () => {
  await expect(matchesChinaRule('2032-01-05', 'legal_workdays')).resolves.toBe(true);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm --filter @vital/server exec vitest run __tests__/holidays/china-calendar.test.ts`

Expected: FAIL because the provider is absent.

- [ ] **Step 3: Implement lookup precedence**

Look up `CN` data first. Explicit `holiday` and `workday` override weekday. If no row exists for a year with no published records, return `weekday_fallback`; otherwise ordinary dates use their Monday–Friday/weekend weekday classification.

- [ ] **Step 4: Run test and typecheck**

Run: `pnpm --filter @vital/server exec vitest run __tests__/holidays/china-calendar.test.ts && pnpm --filter @vital/server typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/holidays apps/server/__tests__/holidays
git commit -m "feat: add China legal calendar evaluation"
```

### Task 4: Calculate fixed recurrence instances

**Files:**
- Modify: `apps/server/src/tasks/recurrence.ts`
- Modify: `apps/server/__tests__/tasks/recurrence.test.ts`

**Consumes:** `RecurrenceKind` and `matchesChinaRule`.

**Produces:**
```ts
export async function nextOccurrenceFor(
  task: Pick<RecurrenceTask, 'dueAt' | 'startAt' | 'timezone' | 'isAllDay'> & { recurrenceKind: RecurrenceKind },
  after: Date,
): Promise<Date | null>;
```

- [ ] **Step 1: Write failing recurrence tests**

```ts
it.each([
  ['weekdays', '2026-09-07'], ['weekends', '2026-09-06'], ['holidays', '2026-10-01'], ['legal_workdays', '2026-02-21'],
] as const)('finds the next %s occurrence', async (recurrenceKind, expected) => {
  await expect(nextOccurrenceFor(task({ recurrenceKind }), beforeExpected)).resolves.toEqual(expectDate(expected));
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `pnpm --filter @vital/server exec vitest run __tests__/tasks/recurrence.test.ts`

Expected: FAIL because fixed kinds are not calculated.

- [ ] **Step 3: Implement candidate iteration**

Keep RRULE logic for legacy compatibility. For a semantic kind, walk local calendar candidates in the task timezone, preserving original local time, and accept candidates by simple frequency, weekday/weekend checks, or `matchesChinaRule`. Bound the lookup to 400 days and return null beyond that range.

- [ ] **Step 4: Run recurrence tests**

Run: `pnpm --filter @vital/server exec vitest run __tests__/tasks/recurrence.test.ts`

Expected: PASS, including existing RRULE tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/tasks/recurrence.ts apps/server/__tests__/tasks/recurrence.test.ts
git commit -m "feat: calculate fixed task recurrence instances"
```

### Task 5: Preserve occurrence completion semantics and schedule reminders per occurrence

**Files:**
- Modify: `apps/server/src/notifications/schedule.ts`
- Modify: `apps/server/src/notifications/outbox.ts`
- Modify: `apps/server/src/tasks/tasks.service.ts`
- Test: `apps/server/__tests__/notifications/schedule.test.ts`
- Test: `apps/server/__tests__/tasks.flow.test.ts`

**Consumes:** `nextOccurrenceFor`, semantic reminder fields, and the existing quiet-hours scheduler.

**Produces:**
```ts
export async function planTaskNotification(task: OccurrenceTaskScheduleInput, prefs: NotificationPrefs, now: Date): Promise<SchedulePlan | null>;
```

- [ ] **Step 1: Write failing scheduling and flow tests**

```ts
it('schedules a 15-minute offset from the next weekly occurrence', async () => {
  await expect(planTaskNotification(task({ reminderMode: 'offset', reminderOffsetMinutes: 15, recurrenceKind: 'weekly' }), prefs, now))
    .resolves.toMatchObject({ scheduledAt: new Date('2026-09-14T00:45:00.000Z') });
});
it('cancels pending notifications when a task is completed', async () => {
  await completeTask(user.id, task.id);
  expect(await liveOutbox(task.id)).toEqual([]);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @vital/server exec vitest run __tests__/notifications/schedule.test.ts __tests__/tasks.flow.test.ts`

Expected: FAIL because scheduling uses only `remindAt` or `dueAt`.

- [ ] **Step 3: Implement occurrence-aware planning**

Keep the current completion model: write one `task_completions` row for the completed occurrence, roll the same active master task forward to the next occurrence, and return it as `todo` only for that next occurrence. Replace every `recurrenceRrule`-only branch in `completeTask`, `uncompleteTask`, smart-list filtering, and `calendar` with an `isRecurring(task)` helper that recognizes legacy RRULE and semantic recurrence kinds. Resolve the next occurrence first. `due` schedules at it; `offset` subtracts the allowed minute value; `custom` schedules `reminderAt` only when still relevant; `none` returns null. Apply quiet hours afterward. Include occurrence timestamp and schedule timestamp in the idempotency key, cancel all unsent records before inserting the new plan, and invoke re-sync on create, patch, complete, uncomplete, and delete.

- [ ] **Step 4: Run server scheduling suite and typecheck**

Run: `pnpm --filter @vital/server exec vitest run __tests__/notifications/schedule.test.ts __tests__/tasks.flow.test.ts && pnpm --filter @vital/server typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/notifications apps/server/src/tasks/tasks.service.ts apps/server/__tests__/notifications apps/server/__tests__/tasks.flow.test.ts
git commit -m "feat: schedule task reminders by occurrence"
```

### Task 6: Add server DTO mapping and legacy compatibility

**Files:**
- Modify: `apps/server/src/tasks/tasks.service.ts`
- Test: `apps/server/__tests__/tasks.flow.test.ts`

**Consumes:** schemas, columns, and scheduler from Tasks 1–5.

**Produces:** task API responses returning both semantic fields and legacy `remindAt`/`recurrence` fields.

- [ ] **Step 1: Write failing API compatibility tests**

```ts
it('returns semantic reminder fields while keeping legacy values', async () => {
  const created = await api.createTask({ title: '提醒', listId, reminderMode: 'custom', reminderAt: '2026-09-08T01:00:00.000Z' });
  expect(created).toMatchObject({ reminderMode: 'custom', reminderAt: '2026-09-08T01:00:00.000Z', remindAt: '2026-09-08T01:00:00.000Z' });
});
```

- [ ] **Step 2: Run flow test and verify it fails**

Run: `pnpm --filter @vital/server exec vitest run __tests__/tasks.flow.test.ts`

Expected: FAIL because semantic fields are omitted from DTO mapping.

- [ ] **Step 3: Map and validate in task service**

Update `toTaskDto`, create, and patch mapping. Synchronize legacy `remindAt` to the effective custom timestamp and legacy RRULE for simple daily/weekly/monthly/yearly kinds. Reject offset/due reminders without a timed `dueAt`; reject custom reminder dates without a valid task timezone.

- [ ] **Step 4: Run task flow tests**

Run: `pnpm --filter @vital/server exec vitest run __tests__/tasks.flow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/tasks/tasks.service.ts apps/server/__tests__/tasks.flow.test.ts
git commit -m "feat: expose semantic task reminders"
```

### Task 7: Build reminder and recurrence controls

**Files:**
- Create: `apps/web/src/features/todos/ReminderPicker.tsx`
- Create: `apps/web/src/features/todos/RecurrencePicker.tsx`
- Modify: `apps/web/src/features/todos/TaskDetail.tsx`
- Modify: `apps/web/src/copy/zh-CN.ts` (or current task-copy source)
- Test: `apps/web/__tests__/features/todos/reminder-picker.test.tsx`
- Test: `apps/web/__tests__/features/todos/recurrence-picker.test.tsx`

**Consumes:** semantic task DTO fields and shared date/time fields.

**Produces:**
```tsx
<ReminderPicker task={task} onChange={(patch: PatchTaskInput) => void onPatch(patch)} />
<RecurrencePicker value={task.recurrenceKind} onChange={(kind: RecurrenceKind) => void onPatch({ recurrenceKind: kind })} />
```

- [ ] **Step 1: Write failing component tests**

```tsx
it('selects a 15-minute preset relative to a timed due date', async () => {
  render(<ReminderPicker task={timedTask} onChange={onChange} />);
  await user.selectOptions(screen.getByLabelText('提醒'), 'offset:15');
  expect(onChange).toHaveBeenCalledWith({ reminderMode: 'offset', reminderOffsetMinutes: 15, reminderAt: null });
});
it('opens the shared date-time field for a custom reminder', async () => {
  render(<ReminderPicker task={timedTask} onChange={onChange} />);
  await user.selectOptions(screen.getByLabelText('提醒'), 'custom');
  expect(screen.getByRole('dialog', { name: '日期选择器' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @vital/web test -- reminder-picker recurrence-picker`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement compact controls**

Use the shared field class and `DateField kind="datetime-local"`. `ReminderPicker` exposes the seven preset values and custom flow; it disables relative choices for all-day or no-time tasks with explanatory copy. `RecurrencePicker` exposes the nine confirmed fixed options and never exposes raw RRULE text. Add matching Chinese copy.

- [ ] **Step 4: Integrate into task detail and run tests**

Replace the direct `remindAt` field and existing recurrence select in `TaskDetail`. Run: `pnpm --filter @vital/web test -- reminder-picker recurrence-picker todos`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/todos apps/web/src/copy apps/web/__tests__/features/todos
git commit -m "feat: add task reminder and recurrence pickers"
```

### Task 8: Add concise task-list summaries and final verification

**Files:**
- Modify: `apps/web/src/features/todos/model.ts`
- Modify: `apps/web/src/features/todos/TaskRow.tsx`
- Modify: `apps/web/__tests__/features/todos/todos.test.tsx`
- Modify: `docs/project-standards.md`

**Consumes:** task semantic fields from Task 1 and picker selections from Task 7.

**Produces:**
```ts
export function taskScheduleSummary(task: Pick<Task, 'dueAt' | 'isAllDay' | 'reminderMode' | 'reminderOffsetMinutes' | 'reminderAt' | 'recurrenceKind'>, timeZone: string): string[];
```

- [ ] **Step 1: Write failing list-summary tests**

```ts
it('renders a concise schedule summary', async () => {
  renderAt('/todos/lists/smart:today');
  const row = await screen.findByRole('option', { name: '发送周报' });
  expect(within(row).getByText('提前 15 分钟')).toBeInTheDocument();
  expect(within(row).getByText('每个法定工作日')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm --filter @vital/web test -- todos`

Expected: FAIL because task rows do not summarize semantic scheduling.

- [ ] **Step 3: Implement summary formatting**

Return only user-visible non-empty fragments: formatted due time, reminder label, recurrence label. Keep fragments in the existing metadata row; never show raw UTC timestamps, RRULE, or holiday-provider implementation details. Record the server-owned calendar and signed test environment constraints in `docs/project-standards.md`.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm --filter @vital/dto build
pnpm --filter @vital/server typecheck
pnpm --filter @vital/server exec vitest run __tests__/tasks/recurrence.test.ts __tests__/notifications/schedule.test.ts __tests__/tasks.flow.test.ts
pnpm --filter @vital/web typecheck
pnpm --filter @vital/web test -- todos reminder-picker recurrence-picker
```

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/todos/model.ts apps/web/src/features/todos/TaskRow.tsx apps/web/__tests__/features/todos/todos.test.tsx docs/project-standards.md
git commit -m "feat: summarize task reminder schedules"
```

## Plan Self-Review

- Spec coverage: Tasks 1–2 cover contract/persistence and compatibility; Task 3 covers China holiday and fallback; Task 4 covers all fixed repeat kinds; Tasks 5–6 cover occurrence-aware outbox and API behavior; Tasks 7–8 cover UI and concise display.
- No-placeholder check: no deferred implementation steps or unspecified test behavior remain.
- Type consistency: `ReminderMode`, `RecurrenceKind`, `nextOccurrenceFor`, `planTaskNotification`, and `taskScheduleSummary` are introduced before their consumers.
