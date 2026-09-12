import { has, register } from '@rabjs/react';
import { InboxUiService } from '@/features/inbox/inbox-ui.service';
import { ReportUiService } from '@/features/reports/report-ui.service';
import { TodosUiService } from '@/features/todos/todos-ui.service';
import { AuthService } from '@/services/auth.service';
import { QueryService } from '@/services/query.service';
import { ThemeService } from '@/services/theme.service';

/** App-lifetime services. Session UI services bind on Shell, not here. */
export function registerVitalServices(): void {
  if (!has(ThemeService)) register(ThemeService);
  if (!has(AuthService)) register(AuthService);
  if (!has(QueryService)) register(QueryService);
}

/**
 * Test-only fallback so workspaces rendered without Shell still resolve
 * Todos/Inbox/Report UI services via the global container.
 */
export function registerSessionUiServicesForTest(): void {
  if (!has(TodosUiService)) register(TodosUiService);
  if (!has(InboxUiService)) register(InboxUiService);
  if (!has(ReportUiService)) register(ReportUiService);
}
