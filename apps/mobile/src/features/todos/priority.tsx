import { Circle, Flag } from 'lucide-react-native';
import type { TaskPriority } from '@vital/dto';
import type { Theme } from '@vital/tokens';
import { Icon } from '../../ui/icon';

export function priorityColor(priority: TaskPriority, t: Theme): string {
  if (priority === 0) return t.statusOverdue;
  if (priority === 1) return t.statusDueSoon;
  if (priority === 2) return t.statusDoing;
  return t.fgMuted;
}

export function PriorityMark({
  priority,
  theme,
  size = 12,
}: {
  priority: TaskPriority;
  theme: Theme;
  size?: number;
}) {
  if (priority === 3) return null;
  const color = priorityColor(priority, theme);
  if (priority === 0) {
    return <Icon icon={Circle} size={size - 2} color={color} fill={color} strokeWidth={0} />;
  }
  return (
    <Icon icon={Flag} size={size} color={color} fill={priority === 1 ? color : undefined} />
  );
}
