export type SchedulerOptions = {
  initialRetryMs?: number;
  maxRetryMs?: number;
  reportIntervalMs?: number;
  now?: () => number;
};

export function createRetryingScheduler(
  task: () => Promise<unknown>,
  reportFailure: (error: unknown) => string,
  options: SchedulerOptions = {},
): () => Promise<void> {
  const initialRetryMs = options.initialRetryMs ?? 15_000;
  const maxRetryMs = options.maxRetryMs ?? 5 * 60_000;
  const reportIntervalMs = options.reportIntervalMs ?? maxRetryMs;
  const now = options.now ?? Date.now;
  let retryMs = initialRetryMs;
  let nextAttemptAt = 0;
  let lastFailureMessage = '';
  let lastReportedAt = 0;

  return async () => {
    if (now() < nextAttemptAt) return;
    try {
      await task();
      retryMs = initialRetryMs;
      nextAttemptAt = 0;
      lastFailureMessage = '';
      lastReportedAt = 0;
    } catch (error) {
      const message = reportFailure(error);
      if (message !== lastFailureMessage || now() - lastReportedAt >= reportIntervalMs) {
        lastFailureMessage = message;
        lastReportedAt = now();
        console.error('Reminder scheduler error:', message);
      }
      nextAttemptAt = now() + retryMs;
      retryMs = Math.min(maxRetryMs, retryMs * 2);
    }
  };
}
