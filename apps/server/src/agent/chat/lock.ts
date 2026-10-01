/** One in-flight chat turn per user. Released in the route finally, including failures. */
const busy = new Set<string>();

export function tryAcquireChat(userId: string): boolean {
  if (busy.has(userId)) return false;
  busy.add(userId);
  return true;
}

export function releaseChat(userId: string): void {
  busy.delete(userId);
}
