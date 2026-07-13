/**
 * Node-only worker bootstrap. Kept in a separate module so the Edge
 * instrumentation compile does not try to bundle child_process/ffmpeg.
 */
export async function startBackgroundWorker(): Promise<void> {
  const { isWorkerEnabled, startWorkerPoller } = await import(
    "@/services/workerService"
  );
  if (isWorkerEnabled()) {
    startWorkerPoller();
  }
}
