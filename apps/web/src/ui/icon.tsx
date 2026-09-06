import type { LucideIcon, LucideProps } from 'lucide-react';

export type { LucideIcon };

const DEFAULT_SIZE = 16;

export function Icon({
  icon: Glyph,
  size = DEFAULT_SIZE,
  strokeWidth = 1.75,
  className,
  ...props
}: { icon: LucideIcon } & LucideProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden
      {...props}
    />
  );
}
