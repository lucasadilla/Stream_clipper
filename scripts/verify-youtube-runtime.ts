import { config } from "dotenv";
import { getFfmpegVersion } from "../lib/ffmpeg";
import {
  baseYtDlpArgs,
  getYoutubeCookieStatus,
  getYtDlpVersion,
  runYtDlp,
} from "../services/youtubeDownloadService";

config();

async function main() {
  const url = process.argv[2]?.trim();
  if (!url) {
    throw new Error(
      "Pass an authorized YouTube URL: npm run youtube:verify -- https://www.youtube.com/watch?v=VIDEO_ID"
    );
  }

  const [ffmpegVersion, ytDlpVersion, cookieStatus] = await Promise.all([
    getFfmpegVersion(),
    getYtDlpVersion(),
    getYoutubeCookieStatus(),
  ]);
  if (!ffmpegVersion) throw new Error("FFmpeg is not installed or is not on PATH.");
  if (!ytDlpVersion) throw new Error("yt-dlp is not installed or is not on PATH.");
  console.log(`FFmpeg: ${ffmpegVersion}`);
  console.log(`yt-dlp: ${ytDlpVersion}`);
  if (!cookieStatus.configured) {
    throw new Error(
      "Set YT_DLP_COOKIES_PATH to your local Netscape cookies.txt before testing."
    );
  }
  if (!cookieStatus.valid) {
    throw new Error(cookieStatus.error || "The YouTube cookies file is invalid.");
  }

  console.log("YouTube cookies: configured and valid");

  const { stdout } = await runYtDlp(
    [
      ...baseYtDlpArgs(),
      "--simulate",
      "--skip-download",
      "--print",
      "%(id)s",
    ],
    url,
    { retries: 1 }
  );
  console.log(`Authorized source check passed: ${stdout.trim() || "video resolved"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Verification failed.");
  process.exit(1);
});
