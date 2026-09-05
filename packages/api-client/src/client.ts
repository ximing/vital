import type {
  AuthMode,
  AuthResponse,
  CalendarQuery,
  CalendarResponse,
  ChangePasswordInput,
  CompleteTaskResponse,
  CreateListInput,
  CreateTagInput,
  CreateTaskInput,
  List,
  ListCollection,
  Tag,
  LoginInput,
  PatchListInput,
  PatchTagInput,
  PatchTaskInput,
  RegisterInput,
  ReorderListsInput,
  ReorderTasksInput,
  SearchInput,
  SearchResponse,
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
  refresh(): Promise<AuthResponse>;
  logout(): Promise<void>;
  me(): Promise<UserProfile>;
  updateMe(input: UpdateMeInput): Promise<UserProfile>;
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
    completeTask: (id) => http.request(`/api/v1/tasks/${id}/complete`, { method: 'POST', body: {} }),
    uncompleteTask: (id, input) =>
      http.request(`/api/v1/tasks/${id}/uncomplete`, { method: 'POST', body: input }),
    restoreTask: (id) => http.request(`/api/v1/tasks/${id}/restore`, { method: 'POST', body: {} }),
    reorderTasks: (input) => http.request('/api/v1/tasks/reorder', { method: 'PUT', body: input }),
    calendar: (query) => http.request('/api/v1/tasks/calendar', { query: { from: query.from, to: query.to } }),
    listTags: () => http.request('/api/v1/tags'),
    createTag: (input) => http.request('/api/v1/tags', { method: 'POST', body: input }),
    patchTag: (id, input) => http.request(`/api/v1/tags/${id}`, { method: 'PATCH', body: input }),
    deleteTag: (id) => http.request(`/api/v1/tags/${id}`, { method: 'DELETE' }),
    search: (input) => http.request('/api/v1/search', { method: 'POST', body: input }),
  };
}
