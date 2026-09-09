import { has, register } from '@rabjs/react';
import { InboxUiService } from '@/features/inbox/inbox-ui.service';
import { ReportUiService } from '@/features/reports/report-ui.service';
import { TodayUiService } from '@/features/today/today-ui.service';
import { TodosUiService } from '@/features/todos/todos-ui.service';
import { AuthService } from '@/services/auth.service';
import { ThemeService } from '@/services/theme.service';

export function registerVitalServices(): void {
  if (!has(ThemeService)) register(ThemeService);
  if (!has(AuthService)) register(AuthService);
  if (!has(TodosUiService)) register(TodosUiService);
  if (!has(InboxUiService)) register(InboxUiService);
  if (!has(ReportUiService)) register(ReportUiService);
  if (!has(TodayUiService)) register(TodayUiService);
}
