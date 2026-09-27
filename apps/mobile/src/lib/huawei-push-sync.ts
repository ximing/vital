export type HuaweiPushPort = {
  getToken(): Promise<string>;
  register(token: string): Promise<void>;
};

export function createHuaweiRegistrar(port: HuaweiPushPort, retryDelayMs = 1500) {
  let lastPosted: string | null = null;
  let inFlight: Promise<void> | null = null;

  async function readToken(): Promise<string> {
    try {
      return (await port.getToken()).trim();
    } catch {
      return '';
    }
  }

  return {
    sync(): Promise<void> {
      if (inFlight) return inFlight;
      const run = (async () => {
        try {
          let token = await readToken();
          if (!token) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            token = await readToken();
          }
          if (!token || token === lastPosted) return;
          await port.register(token);
          lastPosted = token;
        } catch {
          // Keep the previous token so the next foreground can retry.
        }
      })().finally(() => {
        inFlight = null;
      });
      inFlight = run;
      return run;
    },
  };
}
