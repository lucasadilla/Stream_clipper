/**
 * Node-only worker bootstrap. Kept in a separate module so the Edge
 * instrumentation compile does not try to bundle child_process/ffmpeg.
 */
let tokenProviderStarted = false;
let runtimeLogged = false;

async function logMediaRuntime(): Promise<void> {
  if (runtimeLogged) return;
  runtimeLogged = true;
  const [{ getFfmpegVersion }, youtube] = await Promise.all([
    import("@/lib/ffmpeg"),
    import("@/services/youtubeDownloadService"),
  ]);
  const [ffmpegVersion, ytDlpVersion, cookieStatus] = await Promise.all([
    getFfmpegVersion(),
    youtube.getYtDlpVersion(),
    youtube.getYoutubeCookieStatus(),
  ]);
  console.info(`[runtime] FFmpeg: ${ffmpegVersion ?? "not available"}`);
  console.info(`[runtime] yt-dlp: ${ytDlpVersion ?? "not available"}`);
  console.info(
    `[runtime] YouTube cookies: ${
      cookieStatus.valid
        ? "configured and valid"
        : cookieStatus.configured
          ? `invalid (${cookieStatus.error ?? "format error"})`
          : "not configured"
    }`
  );
}

async function startYouTubeTokenProvider(): Promise<void> {
  if (tokenProviderStarted || !process.env.YT_DLP_POT_PROVIDER_URL?.trim()) {
    return;
  }

  const { existsSync } = await import("fs");
  const providerPath =
    "/opt/bgutil-ytdlp-pot-provider/build/main.js";
  if (!existsSync(providerPath)) {
    console.error(`[source] token provider missing at ${providerPath}`);
    return;
  }

  tokenProviderStarted = true;
  const { spawn } = await import("child_process");
  const provider = spawn(process.execPath, [providerPath], {
    stdio: "inherit",
    windowsHide: true,
  });
  provider.once("error", (error) => {
    tokenProviderStarted = false;
    console.error("[source] token provider failed to start:", error);
  });
  provider.once("exit", (code, signal) => {
    tokenProviderStarted = false;
    console.error(
      `[source] token provider exited (code=${code ?? "none"}, signal=${signal ?? "none"})`
    );
  });
  provider.unref();
}

export async function startBackgroundWorker(): Promise<void> {
  await logMediaRuntime();
  await startYouTubeTokenProvider();
  const { isWorkerEnabled, startWorkerPoller } = await import(
    "@/services/workerService"
  );
  if (isWorkerEnabled()) {
    startWorkerPoller();
  }
}
