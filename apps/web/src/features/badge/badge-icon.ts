const SIZE = 32;
const cache = new Map<number, string>();

function labelFor(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** 32×32 PNG badge, base64 without the data-URL prefix. Empty when canvas is unavailable. */
export function renderBadgeOverlay(count: number): string {
  const cached = cache.get(count);
  if (cached !== undefined) return cached;
  const png = drawBadge(count);
  cache.set(count, png);
  return png;
}

function drawBadge(count: number): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#FF3B30';
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.fill();

    const label = labelFor(count);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${label.length >= 3 ? 13 : 18}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, SIZE / 2, SIZE / 2);

    const dataUrl = canvas.toDataURL('image/png');
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : '';
  } catch {
    return '';
  }
}

export function resetBadgeOverlayCache(): void {
  cache.clear();
}
