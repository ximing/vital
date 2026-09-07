export const RAIL_NAV =
  'my-0.5 flex min-h-9 items-center gap-2 rounded-md px-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] transition-[color,background-color] duration-[var(--ease-out)]';

export function railNavClass(active: boolean): string {
  return `${RAIL_NAV} ${
    active ? 'bg-accent-subtle text-fg' : 'text-muted hover:bg-surface-muted hover:text-fg'
  }`;
}

export function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') return '?';
  const first = trimmed[0] ?? '?';
  if (/[\u4e00-\u9fff]/.test(first)) return first;
  const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length >= 2) {
    const a = parts[0]?.[0] ?? '';
    const b = parts[1]?.[0] ?? '';
    return `${a}${b}`.toUpperCase();
  }
  return first.toUpperCase();
}
