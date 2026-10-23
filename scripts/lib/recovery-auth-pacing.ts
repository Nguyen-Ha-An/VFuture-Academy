export const RECOVERY_AUTH_START_INTERVAL_MS = 2_100;

type RecoveryAuthPacingOptions = {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type RecoveryAuthPacer = { waitForStart(): Promise<void> };

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createRecoveryAuthPacer(options: RecoveryAuthPacingOptions = {}): RecoveryAuthPacer {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let nextStartAt = 0;
  let queue = Promise.resolve();

  return {
    waitForStart() {
      const release = queue.then(async () => {
        const delay = Math.max(0, nextStartAt - now());
        if (delay) await sleep(delay);
        nextStartAt = now() + RECOVERY_AUTH_START_INTERVAL_MS;
      });
      queue = release.catch(() => undefined);
      return release;
    },
  };
}

export async function runPacedRecoveryAuthentication<T>(
  pacer: RecoveryAuthPacer,
  task: () => Promise<T>,
  options: Pick<RecoveryAuthPacingOptions, 'sleep'> = {},
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    await pacer.waitForStart();
    try { return await task(); } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
      if (status !== 429 || attempt >= 4) throw error;
      await sleep(Math.min(8_000, 500 * (2 ** attempt)));
    }
  }
}
