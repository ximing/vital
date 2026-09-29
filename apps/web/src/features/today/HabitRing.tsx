import { Check } from 'lucide-react';

const RING_C = 2 * Math.PI * 17;

/**
 * 40px progress ring: the arc fills with today's completion (count lives in
 * the chip beside it, not inside the ring). Once the target is met the ring
 * collapses into a filled ✓ circle — same language as mobile and the review
 * lists. Paused habits render as an empty track.
 *
 * `interactive` previews a check-in when an ancestor `group/habit` is hovered.
 */
export function HabitRing({
  done,
  total,
  complete,
  paused = false,
  interactive = false,
}: {
  done: number;
  total: number;
  complete: boolean;
  paused?: boolean;
  interactive?: boolean;
}) {
  if (complete) {
    return (
      <span
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-done"
        aria-hidden="true"
      >
        <Check size={16} strokeWidth={3.2} className="text-on-accent" />
      </span>
    );
  }
  const progress = paused ? 0 : total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <span
      className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
        interactive
          ? 'transition-[background-color,box-shadow] duration-[var(--ease-out)] group-hover/habit:bg-accent-subtle group-hover/habit:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-primary)_32%,transparent)]'
          : ''
      }`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-10 w-10 -rotate-90">
        <circle
          cx="20"
          cy="20"
          r="17"
          fill="none"
          strokeWidth="3.5"
          className={
            interactive
              ? 'stroke-border transition-[stroke] duration-[var(--ease-out)] group-hover/habit:stroke-accent'
              : 'stroke-border'
          }
        />
        {progress > 0 ? (
          <circle
            cx="20"
            cy="20"
            r="17"
            fill="none"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - progress)}
            className="stroke-accent"
          />
        ) : null}
      </svg>
      {interactive ? (
        <Check
          size={16}
          strokeWidth={3.2}
          className="relative scale-90 text-accent opacity-0 transition-[opacity,transform] duration-[var(--ease-out)] group-hover/habit:scale-100 group-hover/habit:opacity-100"
        />
      ) : null}
    </span>
  );
}
