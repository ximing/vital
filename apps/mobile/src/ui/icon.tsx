import type { LucideIcon, LucideProps } from 'lucide-react-native';

export type { LucideIcon };

export function Icon({
  icon: Glyph,
  size = 22,
  strokeWidth = 1.75,
  color,
  ...props
}: { icon: LucideIcon; color?: string } & LucideProps) {
  return <Glyph size={size} strokeWidth={strokeWidth} color={color} {...props} />;
}
