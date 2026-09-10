import type {
  ActionFeedbackInput,
  AgentAction,
  AgentActionLogItem,
  AgentActionsQuery,
  AgentMemoryItem,
  AgentUsageSummary,
  AgentExecution,
  AgentMetricsResponse,
  AuthMode,
  AuthResponse,
  CalendarQuery,
  CalendarResponse,
  ChangePasswordInput,
  CompleteTaskResponse,
  ConvertInboxInput,
  ConvertInboxResponse,
  CreateHabitInput,
  CreateAgentMemoryInput,
  CreateNotificationChannelInput,
  CreateInboxInput,
  CreateOutcomeInput,
  CurrentReportQuery,
  ExchangeExtensionAuthInput,
  ExtensionAuthCodeResponse,
  FillReportInput,
  GetReportQuery,
  Habit,
  LlmCatalogProvider,
  LlmProviderInput,
  LlmSettingsPublic,
  Outcome,
  OutcomeDetail,
  PatchHabitInput,
  PatchAgentMemoryInput,
  PatchOutcomeInput,
  PutLlmRoutingInput,
  ReportOverview,
  ReportOverviewQuery,
  ReportReview,
  CreateListInput,
  NotificationChannel,
  NotificationChannelCollection,
  PatchNotificationChannelInput,
  CreateTagInput,
  CreateTaskFromTextInput,
  CreateTaskInput,
  ExtractInboxInput,
  InboxCollection,
  InboxItem,
  InboxPreview,
  List,
  ListCollection,
  Tag,
  LoginInput,
  PatchInboxAssetsInput,
  PatchInboxInput,
  PatchReportInput,
  PatchListInput,
  PatchTagInput,
  PatchTaskInput,
  RegisterInput,
  Report,
  ReportCollection,
  ReportEmbedsResponse,
  ReportType,
  ReportTypeCounts,
  ReorderListsInput,
  ReorderTasksInput,
  SearchInput,
  SearchResponse,
  SearchResults,
  SyncChanges,
  SyncHead,
  TagCollection,
  Task,
  TaskCollection,
  TaskCounts,
  TaskDraftTrigger,
  TodayDashboard,
  UncompleteTaskInput,
  UpdateMeInput,
  UpdateOnboardingInput,
  UploadBindInput,
  UploadBindResponse,
  UploadCompleteResponse,
  UploadUrlResponse,
  UserProfile,
  ApiTokenAccessCollection,
  ApiTokenCollection,
  CreateApiTokenInput,
  CreatedApiToken,
} from '@vital/dto';
import { Http, isAuthResponse, tokensForStore } from './http.js';
import { ApiError, type VitalClientOptions } from './types.js';
import { uploadImpl, type UploadInput } from './upload.js';

export interface VitalClient {
  readonly authMode: AuthMode;
  boot(): Promise<boolean>;
  register(input: RegisterInput): Promise<AuthResponse>;
  login(input: LoginInput): Promise<AuthResponse>;
  createExtensionAuthCode(): Promise<ExtensionAuthCodeResponse>;
  exchangeExtensionAuth(input: ExchangeExtensionAuthInput): Promise<AuthResponse>;
  refresh(): Promise<AuthResponse>;
  logout(): Promise<void>;
  me(): Promise<UserProfile>;
  updateMe(input: UpdateMeInput): Promise<UserProfile>;
  listApiTokens(): Promise<ApiTokenCollection>;
  createApiToken(input: CreateApiTokenInput): Promise<CreatedApiToken>;
  revokeApiToken(id: string): Promise<void>;
  listApiTokenAccess(
    id: string,
    query?: { cursor?: string; limit?: number },
  ): Promise<ApiTokenAccessCollection>;
  listNotificationChannels(): Promise<NotificationChannelCollection>;
  createNotificationChannel(input: CreateNotificationChannelInput): Promise<NotificationChannel>;
  patchNotificationChannel(
    id: string,
    input: PatchNotificationChannelInput,
  ): Promise<NotificationChannel>;
  deleteNotificationChannel(id: string): Promise<void>;
  testNotificationChannel(id: string): Promise<void>;
  updateOnboarding(input: UpdateOnboardingInput): Promise<UserProfile>;
  changePassword(input: ChangePasswordInput): Promise<void>;
  abortUpload(id: string): Promise<void>;
  discardUpload(id: string): Promise<void>;
  upload(input: UploadInput): Promise<UploadCompleteResponse>;
  bindUpload(id: string, input: UploadBindInput): Promise<UploadBindResponse>;
  getUploadUrl(id: string): Promise<UploadUrlResponse>;
  listLists(): Promise<ListCollection>;
  createList(input: CreateListInput): Promise<List>;
  reorderLists(input: ReorderListsInput): Promise<ListCollection>;
  patchList(id: string, input: PatchListInput): Promise<List>;
  deleteList(id: string): Promise<void>;
  listTasks(query: { listId: string; cursor?: string; limit?: number }): Promise<TaskCollection>;
  taskCounts(): Promise<TaskCounts>;
  createTask(input: CreateTaskInput): Promise<Task>;
  createTaskFromText(input: CreateTaskFromTextInput): Promise<Task>;
  llmCatalog(): Promise<{ providers: LlmCatalogProvider[] }>;
  addLlmProvider(input: LlmProviderInput): Promise<LlmSettingsPublic>;
  patchLlmProvider(id: string, input: Partial<LlmProviderInput>): Promise<LlmSettingsPublic>;
  removeLlmProvider(id: string): Promise<LlmSettingsPublic>;
  testLlmProvider(id: string, model: string): Promise<{ ok: true }>;
  putLlmRouting(input: PutLlmRoutingInput): Promise<LlmSettingsPublic>;
  getToday(): Promise<TodayDashboard>;
  listOutcomes(status?: 'open' | 'closed'): Promise<Outcome[]>;
  getOutcomeDetail(id: string): Promise<OutcomeDetail>;
  createOutcome(input: CreateOutcomeInput): Promise<Outcome>;
  patchOutcome(id: string, input: PatchOutcomeInput): Promise<Outcome>;
  closeOutcome(id: string): Promise<Outcome>;
  reopenOutcome(id: string): Promise<Outcome>;
  undoOutcome(id: string): Promise<void>;
  refreshOutcome(id: string): Promise<void>;
  listHabits(): Promise<Habit[]>;
  createHabit(input: CreateHabitInput): Promise<Habit>;
  patchHabit(id: string, input: PatchHabitInput): Promise<Habit>;
  deleteHabit(id: string): Promise<void>;
  getAgentUsage(days?: number): Promise<AgentUsageSummary>;
  listAgentExecutions(days?: number): Promise<AgentExecution[]>;
  organizeAgentTasks(): Promise<{ status: 'queued' | 'disabled'; jobId: string | null }>;
  distillAgentMemory(): Promise<{ status: 'queued' | 'disabled'; jobId: string | null }>;
  getAgentMetrics(days?: number): Promise<AgentMetricsResponse>;
  listAgentActions(query?: AgentActionsQuery): Promise<AgentActionLogItem[]>;
  sendAgentActionFeedback(id: string, input: ActionFeedbackInput): Promise<AgentAction>;
  listAgentMemory(): Promise<AgentMemoryItem[]>;
  createAgentMemory(input: CreateAgentMemoryInput): Promise<AgentMemoryItem>;
  patchAgentMemory(id: string, input: PatchAgentMemoryInput): Promise<AgentMemoryItem>;
  deleteAgentMemory(id: string): Promise<void>;
  getTask(id: string): Promise<Task>;
  patchTask(id: string, input: PatchTaskInput): Promise<Task>;
  /** Ask the agent to draft an execution plan; 'pending' returns the existing draft. */
  draftTask(id: string): Promise<TaskDraftTrigger>;
  deleteTask(id: string): Promise<void>;
  completeTask(id: string): Promise<CompleteTaskResponse>;
  uncompleteTask(id: string, input: UncompleteTaskInput): Promise<Task>;
  restoreTask(id: string): Promise<Task>;
  reorderTasks(input: ReorderTasksInput): Promise<void>;
  calendar(query: CalendarQuery): Promise<CalendarResponse>;
  listTags(): Promise<TagCollection>;
  createTag(input: CreateTagInput): Promise<Tag>;
  patchTag(id: string, input: PatchTagInput): Promise<Tag>;
  deleteTag(id: string): Promise<void>;
  search(input: SearchInput): Promise<SearchResponse>;
  /** Meilisearch 全局快搜：跨 任务/线程/收集箱 分组返回精简命中。 */
  searchAll(q: string, limit?: number): Promise<SearchResults>;
  extractInbox(input: ExtractInboxInput): Promise<InboxPreview>;
  listInbox(query?: {
    status?: string;
    tagId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<InboxCollection>;
  createInbox(input: CreateInboxInput, idempotencyKey?: string): Promise<InboxItem>;
  createInboxResult(
    input: CreateInboxInput,
    idempotencyKey?: string,
  ): Promise<{ item: InboxItem; created: boolean }>;
  getInbox(id: string): Promise<InboxItem>;
  patchInbox(id: string, input: PatchInboxInput): Promise<InboxItem>;
  patchInboxAssets(id: string, input: PatchInboxAssetsInput): Promise<InboxItem>;
  deleteInbox(id: string): Promise<void>;
  convertInbox(id: string, input?: ConvertInboxInput): Promise<ConvertInboxResponse>;
  listReports(query?: {
    type?: ReportType;
    cursor?: string;
    limit?: number;
  }): Promise<ReportCollection>;
  getCurrentReport(type: ReportType, at?: string): Promise<Report>;
  getReportCounts(): Promise<ReportTypeCounts>;
  getReportOverview(type: ReportType, at?: string): Promise<ReportOverview>;
  getReport(id: string, query?: GetReportQuery): Promise<Report>;
  getReportReview(id: string): Promise<ReportReview>;
  getReportEmbeds(id: string): Promise<ReportEmbedsResponse>;
  patchReport(id: string, input: PatchReportInput): Promise<Report>;
  fillReport(id: string, input: FillReportInput): Promise<Report>;
  syncHead(): Promise<SyncHead>;
  syncChanges(query: { since: string; limit?: number }): Promise<SyncChanges>;
}

async function persistAuth(options: VitalClientOptions, data: unknown): Promise<AuthResponse> {
  if (!isAuthResponse(data)) {
    throw new ApiError(0, 'INVALID_RESPONSE', '响应格式错误');
  }
  const tokens = tokensForStore(options.authMode, data.tokens);
  await options.tokenStore.setTokens(tokens);
  return { user: data.user, tokens };
}

export function createVitalClient(options: VitalClientOptions): VitalClient {
  const http = new Http(options);
  const skipAuth: { method: 'POST'; skipAuth: true; skipAuthRefresh: true } = {
    method: 'POST',
    skipAuth: true,
    skipAuthRefresh: true,
  };

  async function createInboxResult(
    input: CreateInboxInput,
    idempotencyKey?: string,
  ): Promise<{ item: InboxItem; created: boolean }> {
    const headers: Record<string, string> = {};
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
    const result = await http.requestWithStatus('/api/v1/inbox', {
      method: 'POST',
      body: input,
      ...(idempotencyKey !== undefined ? { headers } : {}),
    });
    return { item: result.data as InboxItem, created: result.status === 201 };
  }

  return {
    authMode: options.authMode,
    boot: () => http.boot(),
    register: async (input) =>
      persistAuth(
        options,
        await http.request<unknown>('/api/v1/auth/register', { ...skipAuth, body: input }),
      ),
    login: async (input) =>
      persistAuth(
        options,
        await http.request<unknown>('/api/v1/auth/login', { ...skipAuth, body: input }),
      ),
    createExtensionAuthCode: () =>
      http.request('/api/v1/auth/extension/code', { method: 'POST', body: {} }),
    exchangeExtensionAuth: async (input) =>
      persistAuth(
        options,
        await http.request<unknown>('/api/v1/auth/extension/exchange', {
          ...skipAuth,
          body: input,
        }),
      ),
    refresh: () => http.refresh(),
    logout: async () => {
      let body: { refreshToken?: string } = {};
      if (options.authMode === 'bearer') {
        const refreshToken = await options.tokenStore.getRefreshToken();
        if (refreshToken !== null && refreshToken !== '') {
          body = { refreshToken };
        }
      }
      try {
        await http.request('/api/v1/auth/logout', { ...skipAuth, body });
      } finally {
        try {
          await options.tokenStore.clear();
        } catch {
          // Local clear is best-effort after logout.
        }
      }
    },
    me: () => http.request('/api/v1/auth/me'),
    updateMe: (input) => http.request('/api/v1/auth/me', { method: 'PATCH', body: input }),
    listApiTokens: () => http.request('/api/v1/tokens'),
    createApiToken: (input) => http.request('/api/v1/tokens', { method: 'POST', body: input }),
    revokeApiToken: (id) => http.request(`/api/v1/tokens/${id}`, { method: 'DELETE' }),
    listApiTokenAccess: (id, query = {}) => {
      const q: Record<string, string | number | boolean | undefined> = {};
      if (query.cursor !== undefined) q.cursor = query.cursor;
      if (query.limit !== undefined) q.limit = query.limit;
      return http.request(`/api/v1/tokens/${id}/access`, { query: q });
    },
    listNotificationChannels: () => http.request('/api/v1/notification-channels'),
    createNotificationChannel: (input) =>
      http.request('/api/v1/notification-channels', { method: 'POST', body: input }),
    patchNotificationChannel: (id, input) =>
      http.request(`/api/v1/notification-channels/${id}`, { method: 'PATCH', body: input }),
    deleteNotificationChannel: (id) =>
      http.request(`/api/v1/notification-channels/${id}`, { method: 'DELETE' }),
    testNotificationChannel: (id) =>
      http.request(`/api/v1/notification-channels/${id}/test`, { method: 'POST' }),
    updateOnboarding: (input) =>
      http.request('/api/v1/auth/onboarding', { method: 'PATCH', body: input }),
    changePassword: async (input) => {
      await http.request('/api/v1/auth/change-password', { method: 'POST', body: input });
      try {
        await options.tokenStore.clear();
      } catch {
        // Server already revoked every session.
      }
    },
    abortUpload: (id) => http.request(`/api/v1/uploads/${id}/abort`, { method: 'POST' }),
    discardUpload: (id) => http.request(`/api/v1/uploads/${id}`, { method: 'DELETE' }),
    upload: (input) => uploadImpl(http, options, input),
    bindUpload: (id, input) =>
      http.request(`/api/v1/uploads/${id}/bind`, { method: 'POST', body: input }),
    getUploadUrl: (id) => http.request(`/api/v1/uploads/${id}/url`),
    listLists: () => http.request('/api/v1/lists'),
    createList: (input) => http.request('/api/v1/lists', { method: 'POST', body: input }),
    reorderLists: (input) => http.request('/api/v1/lists/reorder', { method: 'PUT', body: input }),
    patchList: (id, input) => http.request(`/api/v1/lists/${id}`, { method: 'PATCH', body: input }),
    deleteList: (id) => http.request(`/api/v1/lists/${id}`, { method: 'DELETE' }),
    listTasks: (query) => {
      const q: Record<string, string | number | boolean | undefined> = { listId: query.listId };
      if (query.cursor !== undefined) q.cursor = query.cursor;
      if (query.limit !== undefined) q.limit = query.limit;
      return http.request('/api/v1/tasks', { query: q });
    },
    taskCounts: () => http.request('/api/v1/tasks/counts'),
    createTask: (input) => http.request('/api/v1/tasks', { method: 'POST', body: input }),
    createTaskFromText: (input) =>
      http.request('/api/v1/tasks/from-text', { method: 'POST', body: input }),
    llmCatalog: () => http.request('/api/v1/llm/catalog'),
    addLlmProvider: (input) =>
      http.request('/api/v1/llm/providers', { method: 'POST', body: input }),
    patchLlmProvider: (id, input) =>
      http.request(`/api/v1/llm/providers/${id}`, { method: 'PATCH', body: input }),
    removeLlmProvider: (id) => http.request(`/api/v1/llm/providers/${id}`, { method: 'DELETE' }),
    testLlmProvider: (id, model) =>
      http.request(`/api/v1/llm/providers/${id}/test`, {
        method: 'POST',
        body: { providerId: id, model },
      }),
    putLlmRouting: (input) => http.request('/api/v1/llm/routing', { method: 'PUT', body: input }),
    getToday: () => http.request('/api/v1/today'),
    listOutcomes: (status) => http.request(`/api/v1/outcomes${status ? `?status=${status}` : ''}`),
    getOutcomeDetail: (id) => http.request(`/api/v1/outcomes/${id}/detail`),
    createOutcome: (input) => http.request('/api/v1/outcomes', { method: 'POST', body: input }),
    patchOutcome: (id, input) =>
      http.request(`/api/v1/outcomes/${id}`, { method: 'PATCH', body: input }),
    closeOutcome: (id) => http.request(`/api/v1/outcomes/${id}/close`, { method: 'POST' }),
    reopenOutcome: (id) => http.request(`/api/v1/outcomes/${id}/reopen`, { method: 'POST' }),
    undoOutcome: async (id) => {
      await http.request(`/api/v1/outcomes/${id}/undo`, { method: 'POST' });
    },
    refreshOutcome: async (id) => {
      await http.request(`/api/v1/outcomes/${id}/refresh`, { method: 'POST' });
    },
    listHabits: () => http.request('/api/v1/habits'),
    createHabit: (input) => http.request('/api/v1/habits', { method: 'POST', body: input }),
    patchHabit: (id, input) =>
      http.request(`/api/v1/habits/${id}`, { method: 'PATCH', body: input }),
    deleteHabit: async (id) => {
      await http.request(`/api/v1/habits/${id}`, { method: 'DELETE' });
    },
    listAgentExecutions: (days) =>
      http.request(`/api/v1/agent/executions${days ? `?days=${String(days)}` : ''}`),
    organizeAgentTasks: () => http.request('/api/v1/agent/cluster', { method: 'POST' }),
    distillAgentMemory: () => http.request('/api/v1/agent/memory/distill', { method: 'POST' }),
    getAgentUsage: (days) =>
      http.request(`/api/v1/agent/usage${days ? `?days=${String(days)}` : ''}`),
    getAgentMetrics: (days) =>
      http.request(`/api/v1/agent/metrics${days ? `?days=${String(days)}` : ''}`),
    listAgentActions: (query) =>
      http.request('/api/v1/agent/actions', {
        query: {
          targetType: query?.targetType,
          targetId: query?.targetId,
          actionType: query?.actionType,
          feedback: query?.feedback,
          days: query?.days,
        },
      }),
    sendAgentActionFeedback: (id, input) =>
      http.request(`/api/v1/agent/actions/${id}/feedback`, { method: 'POST', body: input }),
    listAgentMemory: () => http.request('/api/v1/agent/memory'),
    createAgentMemory: (input) =>
      http.request('/api/v1/agent/memory', { method: 'POST', body: input }),
    patchAgentMemory: (id, input) =>
      http.request(`/api/v1/agent/memory/${id}`, { method: 'PATCH', body: input }),
    deleteAgentMemory: async (id) => {
      await http.request(`/api/v1/agent/memory/${id}`, { method: 'DELETE' });
    },
    getTask: (id) => http.request(`/api/v1/tasks/${id}`),
    patchTask: (id, input) => http.request(`/api/v1/tasks/${id}`, { method: 'PATCH', body: input }),
    draftTask: (id) =>
      http.request(`/api/v1/tasks/${id}/draft`, { method: 'POST', body: {} }),
    deleteTask: (id) => http.request(`/api/v1/tasks/${id}`, { method: 'DELETE' }),
    completeTask: (id) =>
      http.request(`/api/v1/tasks/${id}/complete`, { method: 'POST', body: {} }),
    uncompleteTask: (id, input) =>
      http.request(`/api/v1/tasks/${id}/uncomplete`, { method: 'POST', body: input }),
    restoreTask: (id) => http.request(`/api/v1/tasks/${id}/restore`, { method: 'POST', body: {} }),
    reorderTasks: (input) => http.request('/api/v1/tasks/reorder', { method: 'PUT', body: input }),
    calendar: (query) =>
      http.request('/api/v1/tasks/calendar', { query: { from: query.from, to: query.to } }),
    listTags: () => http.request('/api/v1/tags'),
    createTag: (input) => http.request('/api/v1/tags', { method: 'POST', body: input }),
    patchTag: (id, input) => http.request(`/api/v1/tags/${id}`, { method: 'PATCH', body: input }),
    deleteTag: (id) => http.request(`/api/v1/tags/${id}`, { method: 'DELETE' }),
    search: (input) => http.request('/api/v1/search', { method: 'POST', body: input }),
    searchAll: (q, limit) =>
      http.request('/api/v1/search', { query: { q, limit } }),
    extractInbox: (input) => http.request('/api/v1/inbox/extract', { method: 'POST', body: input }),
    listInbox: (query = {}) => {
      const q: Record<string, string | number | boolean | undefined> = {};
      if (query.status !== undefined) q.status = query.status;
      if (query.tagId !== undefined) q.tagId = query.tagId;
      if (query.cursor !== undefined) q.cursor = query.cursor;
      if (query.limit !== undefined) q.limit = query.limit;
      return http.request('/api/v1/inbox', { query: q });
    },
    createInboxResult,
    createInbox: async (input, idempotencyKey) =>
      (await createInboxResult(input, idempotencyKey)).item,
    getInbox: (id) => http.request(`/api/v1/inbox/${id}`),
    patchInbox: (id, input) =>
      http.request(`/api/v1/inbox/${id}`, { method: 'PATCH', body: input }),
    patchInboxAssets: (id, input) =>
      http.request(`/api/v1/inbox/${id}/assets`, { method: 'PATCH', body: input }),
    deleteInbox: (id) => http.request(`/api/v1/inbox/${id}`, { method: 'DELETE' }),
    convertInbox: (id, input = {}) =>
      http.request(`/api/v1/inbox/${id}/convert`, { method: 'POST', body: input }),
    listReports: (query = {}) => {
      const q: Record<string, string | number | boolean | undefined> = {};
      if (query.type !== undefined) q.type = query.type;
      if (query.cursor !== undefined) q.cursor = query.cursor;
      if (query.limit !== undefined) q.limit = query.limit;
      return http.request('/api/v1/reports', { query: q });
    },
    getCurrentReport: (type, at) => {
      const query: CurrentReportQuery = { type, ...(at ? { at } : {}) };
      return http.request('/api/v1/reports/current', { query });
    },
    getReportCounts: () => http.request('/api/v1/reports/counts'),
    getReportOverview: (type, at) => {
      const query: ReportOverviewQuery = { type, ...(at ? { at } : {}) };
      return http.request('/api/v1/reports/overview', { query });
    },
    getReport: (id, query = {}) => {
      const q: Record<string, string | number | boolean | undefined> = {};
      if (query.asOf !== undefined) q.asOf = query.asOf;
      return http.request(`/api/v1/reports/${id}`, { query: q });
    },
    getReportReview: (id) => http.request(`/api/v1/reports/${id}/review`),
    getReportEmbeds: (id) => http.request(`/api/v1/reports/${id}/embeds`),
    patchReport: (id, input) =>
      http.request(`/api/v1/reports/${id}`, { method: 'PATCH', body: input }),
    fillReport: (id, input) =>
      http.request(`/api/v1/reports/${id}/fill`, { method: 'POST', body: input }),
    syncHead: () => http.request('/api/v1/sync/head'),
    syncChanges: (query) => {
      const q: Record<string, string | number | boolean | undefined> = { since: query.since };
      if (query.limit !== undefined) q.limit = query.limit;
      return http.request('/api/v1/sync/changes', { query: q });
    },
  };
}
