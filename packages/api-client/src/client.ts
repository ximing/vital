import type {
  AuthMode,
  AuthResponse,
  CalendarQuery,
  CalendarResponse,
  ChangePasswordInput,
  CompleteTaskResponse,
  ConvertInboxInput,
  ConvertInboxResponse,
  CreateNotificationChannelInput,
  CreateInboxInput,
  CurrentReportQuery,
  ExchangeExtensionAuthInput,
  ExtensionAuthCodeResponse,
  FillReportInput,
  GetReportQuery,
  ReportOverview,
  ReportOverviewQuery,
  ReportReview,
  CreateListInput,
  NotificationChannel,
  NotificationChannelCollection,
  PatchNotificationChannelInput,
  CreateTagInput,
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
  ReorderListsInput,
  ReorderTasksInput,
  SearchInput,
  SearchResponse,
  SyncHead,
  TagCollection,
  Task,
  TaskCollection,
  UncompleteTaskInput,
  UpdateMeInput,
  UpdateOnboardingInput,
  UploadBindInput,
  UploadBindResponse,
  UploadCompleteResponse,
  UploadPresignInput,
  UploadPresignResponse,
  UserProfile,
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
  presignUpload(input: UploadPresignInput): Promise<UploadPresignResponse>;
  completeUpload(id: string): Promise<UploadCompleteResponse>;
  abortUpload(id: string): Promise<void>;
  discardUpload(id: string): Promise<void>;
  uploadUrl(id: string): string;
  fetchUploadBlob(id: string): Promise<Blob>;
  upload(input: UploadInput): Promise<UploadCompleteResponse>;
  bindUpload(id: string, input: UploadBindInput): Promise<UploadBindResponse>;
  listLists(): Promise<ListCollection>;
  createList(input: CreateListInput): Promise<List>;
  reorderLists(input: ReorderListsInput): Promise<ListCollection>;
  patchList(id: string, input: PatchListInput): Promise<List>;
  deleteList(id: string): Promise<void>;
  listTasks(query: { listId: string; cursor?: string; limit?: number }): Promise<TaskCollection>;
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(id: string): Promise<Task>;
  patchTask(id: string, input: PatchTaskInput): Promise<Task>;
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
  extractInbox(input: ExtractInboxInput): Promise<InboxPreview>;
  listInbox(query?: { status?: string; cursor?: string; limit?: number }): Promise<InboxCollection>;
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
  getReportOverview(type: ReportType, at?: string): Promise<ReportOverview>;
  getReport(id: string, query?: GetReportQuery): Promise<Report>;
  getReportReview(id: string): Promise<ReportReview>;
  getReportEmbeds(id: string): Promise<ReportEmbedsResponse>;
  patchReport(id: string, input: PatchReportInput): Promise<Report>;
  fillReport(id: string, input: FillReportInput): Promise<Report>;
  syncHead(): Promise<SyncHead>;
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
  const baseUrl = options.baseUrl.replace(/\/$/, '');
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
    presignUpload: (input) =>
      http.request('/api/v1/uploads/presign', { method: 'POST', body: input }),
    completeUpload: (id) =>
      http.request(`/api/v1/uploads/${id}/complete`, { method: 'POST', body: {} }),
    abortUpload: (id) => http.request(`/api/v1/uploads/${id}/abort`, { method: 'POST' }),
    discardUpload: (id) => http.request(`/api/v1/uploads/${id}`, { method: 'DELETE' }),
    uploadUrl: (id) => `${baseUrl}/api/v1/uploads/${id}`,
    fetchUploadBlob: (id) => http.requestBlob(`/api/v1/uploads/${id}`),
    upload: (input) => uploadImpl(http, options, input),
    bindUpload: (id, input) =>
      http.request(`/api/v1/uploads/${id}/bind`, { method: 'POST', body: input }),
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
    createTask: (input) => http.request('/api/v1/tasks', { method: 'POST', body: input }),
    getTask: (id) => http.request(`/api/v1/tasks/${id}`),
    patchTask: (id, input) => http.request(`/api/v1/tasks/${id}`, { method: 'PATCH', body: input }),
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
    extractInbox: (input) => http.request('/api/v1/inbox/extract', { method: 'POST', body: input }),
    listInbox: (query = {}) => {
      const q: Record<string, string | number | boolean | undefined> = {};
      if (query.status !== undefined) q.status = query.status;
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
  };
}
