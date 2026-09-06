export function ymdParts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

export function padYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const { y, m, d } = ymdParts(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return padYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addMonthsYmd(ymd: string, delta: number): string {
  const { y, m, d } = ymdParts(ymd);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  return padYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, Math.min(d, last));
}

export function weekdayOfYmd(ymd: string): number {
  const { y, m, d } = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function startOfWeekYmd(ymd: string, weekStartsOn: 0 | 1): string {
  const delta = (weekdayOfYmd(ymd) - weekStartsOn + 7) % 7;
  return addDaysYmd(ymd, -delta);
}

export function weekDays(anchor: string, weekStartsOn: 0 | 1): string[] {
  const start = startOfWeekYmd(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
}

export function monthGrid(year: number, month: number, weekStartsOn: 0 | 1): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay();
  let lead = firstDow - weekStartsOn;
  if (lead < 0) lead += 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < 42; i += 1) {
    const day = i - lead + 1;
    cells.push(day >= 1 && day <= days ? padYmd(year, month, day) : null);
  }
  return cells;
}
