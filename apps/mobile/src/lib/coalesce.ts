/** Run work one at a time. A call that arrives mid-flight is kept and runs once more after. */
export function createCoalescedRunner(): (work: () => Promise<void>) => Promise<void> {
  let current: Promise<void> | null = null;
  let again = false;
  let latest: () => Promise<void> = async () => undefined;

  return function run(work: () => Promise<void>): Promise<void> {
    latest = work;
    if (current) {
      again = true;
      return current;
    }
    const job = (async () => {
      const scheduled = latest;
      try {
        await scheduled();
      } finally {
        current = null;
        if (again) {
          again = false;
          await run(latest);
        }
      }
    })();
    current = job;
    return job;
  };
}
