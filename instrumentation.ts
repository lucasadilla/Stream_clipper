export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { isWorkerEnabled, startWorkerPoller } = await import(
    "@/services/workerService"
  );
  if (isWorkerEnabled()) {
    startWorkerPoller();
  }
}
