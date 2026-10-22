import { View } from 'react-native';
import { Activity, Brain, CalendarDays, Repeat, Waypoints } from 'lucide-react-native';
import { NavRow } from '../../components/NavRow';
import { SectionHead } from '../../components/SectionHead';
import { copy } from '../../lib/copy';
import type { LucideIcon } from '../../ui/icon';
import type { SettingsHomeStyles } from './settings-home-styles';

export function SettingsAiSection({
  styles,
  todayExecs,
  onOpen,
}: {
  styles: SettingsHomeStyles;
  todayExecs: number | null;
  onOpen: (href: '/habits' | '/days' | '/threads' | '/activity' | '/memory') => void;
}) {
  const aiItems: {
    icon: LucideIcon;
    label: string;
    href: '/habits' | '/days' | '/threads' | '/activity' | '/memory';
    value?: string;
  }[] = [
    { icon: Repeat, label: copy.me.habits, href: '/habits' },
    { icon: CalendarDays, label: copy.me.days, href: '/days' },
    { icon: Waypoints, label: copy.me.threads, href: '/threads' },
    {
      icon: Activity,
      label: copy.me.agentActivity,
      href: '/activity',
      value:
        todayExecs === null ? undefined : copy.me.activityToday.replace('{n}', String(todayExecs)),
    },
    { icon: Brain, label: copy.me.memory, href: '/memory' },
  ];

  return (
    <>
      <SectionHead title={copy.me.ai} />
      <View style={[styles.card, styles.cardFlush]}>
        {aiItems.map((item, index) => (
          <NavRow
            key={item.href}
            icon={item.icon}
            label={item.label}
            value={item.value}
            divider={index > 0}
            onPress={() => onOpen(item.href)}
          />
        ))}
      </View>
    </>
  );
}
