import type {
  ActionFeedbackInput,
  AgentAction,
  AgentActionLogItem,
  AppAndroidReleaseResponse,
  AppLatestReleaseResponse,
  AgentActionsQuery,
  AgentMemoryItem,
  AgentScheduleCapability,
  AgentScheduleItem,
  AgentScheduleResponse,
  AgentUsageSummary,
  AgentExecution,
  AgentMetricsResponse,
  ApplyPlanResult,
  ChatInvalidateTag,
  ChatSession,
  PostChatMessageInput,
  AuthMode,
  AuthResponse,
  CalendarQuery,
  CalendarResponse,
  DeviceCalendarSyncInput,
  DeviceCalendarSyncResult,
  ChangePasswordInput,
  CompleteTaskResponse,
  ConvertInboxInput,
  ConvertInboxResponse,
  CreateDayInput,
  CreateEnergyLogInput,
  EnergyLog,
  EnergyLogList,
  EnergyLogQuery,
  CreateHabitInput,
  Day,
  DayCalendarMeta,
  DayCatalogResponse,
  DayCollection,
  HabitCheckinsQuery,
  HabitCheckinsResponse,
  PatchDayInput,
  CreateAgentMemoryInput,
  CreateNotificationChannelInput,
  CreateInboxInput,
  CreateOutcomeInput,
  ExchangeExtensionAuthInput,
  ExtensionAuthCodeResponse,
  QrLoginDecision,
  QrLoginPollResponse,
  QrLoginTicket,
  QrLoginTicketInput,
  FillReportInput,
  GetReportQuery,
  ReportGenerateTrigger,
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
  ReportReview,
  CreateListInput,
  NotificationChannel,
  PushDevice,
  RegisterPushDeviceInput,
  NotificationChannelCollection,
  PatchNotificationChannelInput,
  CreateTagInput,
  CreateTaskFromTextInput,
  CreateTaskInput,
  ExtractInboxInput,
  ExtractJob,
  ExtractJobList,
  InboxCollection,
  InboxItem,
  InboxMarkdown,
  InboxPreview,
  InboxExportInwitResponse,
  InwitConfigInput,
  InwitConfigPublic,
  InwitTestResponse,
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
  TodayLayoutContext,
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
import { Http, type BootResult } from './http.js';
import type { VitalClientOptions } from './types.js';
import type { UploadInput } from './upload.js';
import { bindAgent } from './domains/agent.js';
import { bindAuth } from './domains/auth.js';
import { bindDays } from './domains/days.js';
import { bindEnergy } from './domains/energy.js';
import { bindHabits } from './domains/habits.js';
import { bindInbox } from './domains/inbox.js';
import { bindLists } from './domains/lists.js';
import { bindLlm } from './domains/llm.js';
import { bindNotifications } from './domains/notifications.js';
import { bindOutcomes } from './domains/outcomes.js';
import { bindReports } from './domains/reports.js';
import { bindSearch } from './domains/search.js';
import { bindSync } from './domains/sync.js';
import { bindTags } from './domains/tags.js';
import { bindTasks } from './domains/tasks.js';
import { bindToday } from './domains/today.js';
import { bindTokens } from './domains/tokens.js';
import { bindUploads } from './domains/uploads.js';

export interface VitalClient {
  readonly authMode: AuthMode;
  boot(): Promise<BootResult>;
  getAndroidRelease(): Promise<AppAndroidReleaseResponse>;
  getAppLatest(): Promise<AppLatestReleaseResponse>;
  register(input: RegisterInput): Promise<AuthResponse>;
  login(input: LoginInput): Promise<AuthResponse>;
  createExtensionAuthCode(): Promise<ExtensionAuthCodeResponse>;
  exchangeExtensionAuth(input: ExchangeExtensionAuthInput): Promise<AuthResponse>;
  createQrLogin(): Promise<QrLoginTicket>;
  pollQrLogin(input: QrLoginTicketInput): Promise<QrLoginPollResponse>;
  scanQrLogin(input: QrLoginTicketInput): Promise<QrLoginDecision>;
  confirmQrLogin(input: QrLoginTicketInput): Promise<QrLoginDecision>;
  cancelQrLogin(input: QrLoginTicketInput): Promise<QrLoginDecision>;
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
  registerPushDevice(input: RegisterPushDeviceInput): Promise<PushDevice>;
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
  putTodayLayoutContext(input: TodayLayoutContext): Promise<{ ok: true }>;
  syncDeviceCalendar(input: DeviceCalendarSyncInput): Promise<DeviceCalendarSyncResult>;
  listOutcomes(status?: 'open' | 'closed'): Promise<Outcome[]>;
  getOutcomeDetail(id: string): Promise<OutcomeDetail>;
  createOutcome(input: CreateOutcomeInput): Promise<Outcome>;
  patchOutcome(id: string, input: PatchOutcomeInput): Promise<Outcome>;
  closeOutcome(id: string): Promise<Outcome>;
  reopenOutcome(id: string): Promise<Outcome>;
  undoOutcome(id: string): Promise<void>;
  refreshOutcome(id: string): Promise<void>;
  listHabits(): Promise<Habit[]>;
  listHabitCheckins(query: HabitCheckinsQuery): Promise<HabitCheckinsResponse>;
  createHabit(input: CreateHabitInput): Promise<Habit>;
  patchHabit(id: string, input: PatchHabitInput): Promise<Habit>;
  tickHabit(id: string): Promise<Habit>;
  deleteHabit(id: string): Promise<void>;
  listEnergyLogs(query?: EnergyLogQuery): Promise<EnergyLogList>;
  createEnergyLog(input: CreateEnergyLogInput): Promise<EnergyLog>;
  listDays(): Promise<DayCollection>;
  listDayCatalog(): Promise<DayCatalogResponse>;
  getDayCalendarMeta(year: number): Promise<DayCalendarMeta>;
  getDay(id: string): Promise<Day>;
  createDay(input: CreateDayInput): Promise<Day>;
  patchDay(id: string, input: PatchDayInput): Promise<Day>;
  deleteDay(id: string): Promise<void>;
  getAgentUsage(days?: number): Promise<AgentUsageSummary>;
  listAgentExecutions(days?: number): Promise<AgentExecution[]>;
  organizeAgentTasks(): Promise<{ status: 'queued' | 'disabled'; jobId: string | null }>;
  getChatSession(): Promise<ChatSession>;
  resetChat(): Promise<ChatSession>;
  postChatMessage(input: PostChatMessageInput, signal?: AbortSignal): Promise<Response>;
  applyChatPreview(
    id: string,
  ): Promise<{ summary: string; invalidate: ChatInvalidateTag[]; errors: string[] }>;
  applyAgentPlan(id: string): Promise<ApplyPlanResult>;
  cancelChatPreview(id: string): Promise<{ ok: true }>;
  undoChat(hintId: string): Promise<{ ok: true; invalidate: ChatInvalidateTag[] }>;
  distillAgentMemory(): Promise<{ status: 'queued' | 'disabled'; jobId: string | null }>;
  getAgentMetrics(days?: number): Promise<AgentMetricsResponse>;
  /** Read-only scheduling state per capability (settings schedule view). */
  listAgentSchedule(): Promise<AgentScheduleResponse>;
  /** Cancel the accumulated pending observations of a capability (not disabling it). */
  cancelAgentSchedule(capability: AgentScheduleCapability): Promise<AgentScheduleItem>;
  listAgentActions(query?: AgentActionsQuery): Promise<AgentActionLogItem[]>;
  sendAgentActionFeedback(id: string, input: ActionFeedbackInput): Promise<AgentAction>;
  /** Compensate a materialized acceptance: soft-deletes the created subtasks. */
  undoAgentAction(id: string): Promise<AgentAction>;
  listAgentMemory(): Promise<AgentMemoryItem[]>;
  createAgentMemory(input: CreateAgentMemoryInput): Promise<AgentMemoryItem>;
  patchAgentMemory(id: string, input: PatchAgentMemoryInput): Promise<AgentMemoryItem>;
  deleteAgentMemory(id: string): Promise<void>;
  getTask(id: string): Promise<Task>;
  patchTask(id: string, input: PatchTaskInput): Promise<Task>;
  /** Read-only draft job status; does not enqueue. */
  getTaskDraft(id: string): Promise<TaskDraftTrigger>;
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
  /** Start an article extract. Returns the existing in-flight or recent succeeded job for the same URL. */
  startInboxExtract(input: ExtractInboxInput): Promise<ExtractJob>;
  /** Poll an extract job. Does not count against the inbox rate limit. */
  getInboxExtract(id: string): Promise<ExtractJob>;
  /** One page of article jobs. Omits the preview and does not start work. */
  listInboxExtractJobs(query?: { page?: number; limit?: number }): Promise<ExtractJobList>;
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
  getInboxMarkdown(id: string): Promise<InboxMarkdown>;
  patchInbox(id: string, input: PatchInboxInput): Promise<InboxItem>;
  patchInboxAssets(id: string, input: PatchInboxAssetsInput): Promise<InboxItem>;
  deleteInbox(id: string): Promise<void>;
  convertInbox(id: string, input?: ConvertInboxInput): Promise<ConvertInboxResponse>;
  startInboxErrand(id: string): Promise<{ taskId: string; jobId: string | null }>;
  startTaskErrand(id: string): Promise<{ taskId: string; jobId: string | null }>;
  exportInboxToInwit(id: string): Promise<InboxExportInwitResponse>;
  getInwitConfig(): Promise<InwitConfigPublic>;
  putInwitConfig(input: InwitConfigInput): Promise<InwitConfigPublic>;
  testInwit(): Promise<InwitTestResponse>;
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
  generateReport(id: string): Promise<ReportGenerateTrigger>;
  syncHead(): Promise<SyncHead>;
  syncChanges(query: { since: string; limit?: number }): Promise<SyncChanges>;
}

export function createVitalClient(options: VitalClientOptions): VitalClient {
  const http = new Http(options);
  const skipAuth = {
    method: 'POST' as const,
    skipAuth: true as const,
    skipAuthRefresh: true as const,
  };

  return {
    authMode: options.authMode,
    ...bindAuth(http, options, skipAuth),
    ...bindTokens(http),
    ...bindNotifications(http),
    ...bindUploads(http, options),
    ...bindLists(http),
    ...bindTasks(http),
    ...bindLlm(http),
    ...bindToday(http),
    ...bindOutcomes(http),
    ...bindHabits(http),
    ...bindEnergy(http),
    ...bindDays(http),
    ...bindAgent(http),
    ...bindTags(http),
    ...bindSearch(http),
    ...bindInbox(http),
    ...bindReports(http),
    ...bindSync(http),
  };
}
