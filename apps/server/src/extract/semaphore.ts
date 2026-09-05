/** Process-wide cap for request-thread extract (v1 exception vs a worker). */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }

  get running(): number {
    return this.active;
  }
}

export const EXTRACT_CONCURRENCY = 2;
export const extractSemaphore = new Semaphore(EXTRACT_CONCURRENCY);
