import {
  llmReady,
  SMART_LIST_IDS,
  type CreateTaskFromTextInput,
  type CreateTaskInput,
  type LlmSettingsPublic,
  type SmartListId,
  type TaskPriority,
} from '@vital/dto';
import { fromDatetimeLocal, zonedLocalMidnightIso } from '../../lib/format';

export type ComposeDue =
  | { source: 'preset' }
  | { source: 'none' }
  | { source: 'day'; ymd: string; allDay: boolean; hm: string | null };

export type ComposeRequest =
  | { kind: 'text'; body: CreateTaskFromTextInput }
  | { kind: 'fields'; body: CreateTaskInput };

export function smartListIdOf(listId: string): SmartListId | undefined {
  return (SMART_LIST_IDS as readonly string[]).includes(listId) ? (listId as SmartListId) : undefined;
}

/**
 * Use task.parse when a model is routed. A view-implied due (Today, a week day)
 * is context for the parser. A date or tag the user picked is a structured create.
 */
export function willParseTaskText(input: {
  llm: LlmSettingsPublic | null | undefined;
  due: ComposeDue;
  tagIds: readonly string[];
}): boolean {
  return llmReady(input.llm, 'task.parse') && input.due.source === 'preset' && input.tagIds.length === 0;
}

export function composeTaskRequest(input: {
  text: string;
  listId: string;
  timezone: string;
  llm: LlmSettingsPublic | null | undefined;
  due: ComposeDue;
  priority: TaskPriority | null;
  tagIds: readonly string[];
  extra?: Partial<CreateTaskInput>;
  smartListId?: SmartListId;
  contextDueYmd?: string;
}): ComposeRequest {
  const text = input.text.trim();
  if (
    !willParseTaskText({
      llm: input.llm,
      due: input.due,
      tagIds: input.tagIds,
    })
  ) {
    return { kind: 'fields', body: fieldsInput(text, input) };
  }
  const status =
    input.extra?.status === 'doing' || input.extra?.status === 'todo' ? input.extra.status : undefined;
  const priority = input.priority ?? input.extra?.priority;
  const body: CreateTaskFromTextInput = {
    text,
    listId: input.listId,
    timezone: input.timezone,
  };
  if (input.smartListId !== undefined) body.smartListId = input.smartListId;
  if (input.contextDueYmd !== undefined && input.contextDueYmd !== '') body.dueYmd = input.contextDueYmd;
  if (status !== undefined) body.status = status;
  if (priority !== undefined) body.priority = priority;
  return { kind: 'text', body };
}

function fieldsInput(
  text: string,
  input: {
    listId: string;
    timezone: string;
    due: ComposeDue;
    priority: TaskPriority | null;
    tagIds: readonly string[];
    extra?: Partial<CreateTaskInput>;
  },
): CreateTaskInput {
  const body: CreateTaskInput = { title: text, listId: input.listId };
  if (input.due.source === 'preset' && input.extra !== undefined) Object.assign(body, input.extra);
  if (input.due.source === 'day') {
    body.timezone = input.timezone;
    if (input.due.allDay || input.due.hm === null) {
      body.dueAt = zonedLocalMidnightIso(input.timezone, input.due.ymd);
      body.isAllDay = true;
    } else {
      body.dueAt = fromDatetimeLocal(`${input.due.ymd}T${input.due.hm}`, input.timezone);
      body.isAllDay = false;
    }
  }
  if (input.extra?.status === 'doing' || input.extra?.status === 'todo') body.status = input.extra.status;
  if (input.priority !== null) body.priority = input.priority;
  else if (input.due.source === 'preset' && input.extra?.priority !== undefined) {
    body.priority = input.extra.priority;
  }
  if (input.tagIds.length > 0) body.tagIds = [...input.tagIds];
  return body;
}
