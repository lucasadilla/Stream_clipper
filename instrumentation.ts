export async function register() {
  // Only load Node worker code on the Node.js runtime. A static edge import
  // of workerService/ffmpeg pulls in child_process and breaks the build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundWorker } = await import("./instrumentation.node");
    await startBackgroundWorker();
  }
}
