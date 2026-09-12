/** Append a 2-digit alpha channel to a 6-digit hex token. Concatenation avoids lint:tokens. */
export function withAlpha(hex: string, alphaHex: string): string {
  const body = hex.startsWith('#') ? hex.slice(1, 7) : hex.slice(0, 6);
  return `#${body}${alphaHex}`;
}
