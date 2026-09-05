export interface SyncHead {
  tasksMaxUpdatedAt: string | null;
  inboxMaxUpdatedAt: string | null;
  reportsMaxUpdatedAt: string | null;
  revision: number;
}
