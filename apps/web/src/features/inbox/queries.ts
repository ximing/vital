import type {
  ConvertInboxInput,
  ConvertInboxResponse,
  InboxItem,
  InboxPreview,
  PatchInboxInput,
  Tag,
} from '@vital/dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { markOnboarding } from '@/features/onboarding/mark';
import { todoKeys } from '@/features/todos/queries';
import { humanError } from '@/lib/errors';
import { createInputFromPreview, pendingIdForUrl, type PendingSave } from './model';
import { inboxUi } from './inbox-ui.service';

export const inboxKeys = {
  all: ['inbox'] as const,
  list: ['inbox', 'list'] as const,
  item: (id: string) => ['inbox', 'item', id] as const,
};

async function fetchAllInbox(): Promise<InboxItem[]> {
  const items: InboxItem[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const page = await client.listInbox({ cursor, limit: 100 });
    items.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return items;
}

export function useInboxListQuery() {
  return useQuery({
    queryKey: inboxKeys.list,
    queryFn: fetchAllInbox,
  });
}

export function useInboxItemQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: inboxKeys.item(id),
    queryFn: () => client.getInbox(id),
    enabled: enabled && id !== '',
  });
}

async function markCaptured(): Promise<void> {
  await markOnboarding({ capturedInbox: true });
}

export function useInboxActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: inboxKeys.all });

  const patch = useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchInboxInput }) =>
      client.patchInbox(id, input),
    onSuccess: () => invalidate(),
  });

  const createTag = useMutation({
    mutationFn: (name: string): Promise<Tag> => client.createTag({ name }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: todoKeys.tags });
    },
  });

  const convert = useMutation({
    mutationFn: ({ id, input }: { id: string; input?: ConvertInboxInput }) =>
      client.convertInbox(id, input),
    onSuccess: async () => {
      await invalidate();
      await qc.invalidateQueries({ queryKey: todoKeys.all });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => client.deleteInbox(id),
    onSuccess: () => invalidate(),
  });

  async function extract(url: string): Promise<InboxPreview> {
    const id = pendingIdForUrl(url);
    inboxUi().upsertPending({
      id,
      url,
      phase: 'processing',
      error: null,
      preview: null,
    });
    try {
      const preview = await client.extractInbox({ url });
      inboxUi().removePending(id);
      inboxUi().setPreview(preview);
      return preview;
    } catch (err) {
      inboxUi().upsertPending({
        id,
        url,
        phase: 'failed',
        error: humanError(err),
        preview: null,
      });
      throw err;
    }
  }

  async function createFromPreview(): Promise<InboxItem> {
    const ui = inboxUi();
    if (ui.preview === null) throw new Error('没有预览');
    const input = createInputFromPreview(ui.preview, ui.previewTitle);
    const failId = pendingIdForUrl(input.originalUrl ?? input.title);
    try {
      const item = await client.createInbox(input);
      inboxUi().setPreview(null);
      inboxUi().removePending(failId);
      await markCaptured();
      await invalidate();
      return item;
    } catch (err) {
      inboxUi().upsertPending({
        id: failId,
        url: input.originalUrl ?? '',
        phase: 'failed',
        error: humanError(err),
        preview: ui.preview,
      });
      throw err;
    }
  }

  async function createManual(title: string): Promise<InboxItem> {
    const item = await client.createInbox({ title, source: 'manual' });
    await markCaptured();
    await invalidate();
    return item;
  }

  async function retry(save: PendingSave): Promise<InboxItem | InboxPreview | undefined> {
    inboxUi().removePending(save.id);
    if (save.preview) {
      inboxUi().setPreview(save.preview);
      return createFromPreview();
    }
    if (save.url !== '') return extract(save.url);
    return undefined;
  }

  async function convertKeepUrl(id: string): Promise<ConvertInboxResponse> {
    return convert.mutateAsync({ id, input: {} });
  }

  return {
    patch,
    createTag,
    convert,
    remove,
    extract,
    createFromPreview,
    createManual,
    retry,
    convertKeepUrl,
    invalidate,
  };
}
