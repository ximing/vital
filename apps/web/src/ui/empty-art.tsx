import { VitalMark } from '@/shell/VitalMark';

export function EmptyArt({ className = '' }: { className?: string }) {
  return (
    <div className={`relative mb-5 h-14 w-14 ${className}`} aria-hidden="true">
      <span className="absolute inset-0 rounded-full bg-accent-subtle" />
      <VitalMark className="relative h-14 w-14 p-2 text-accent" />
    </div>
  );
}
