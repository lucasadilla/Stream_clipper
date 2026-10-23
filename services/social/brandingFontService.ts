import { existsSync } from "fs";
import path from "path";
export function brandingFontFile(): string | undefined {
  // Windows FFmpeg builds can crash when fontconfig has no configuration.
  return [
    ...(process.platform === "win32" ? [path.join(process.env.WINDIR || "C:/Windows", "Fonts", "arialbd.ttf")] : []),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  ].find((candidate) => existsSync(candidate));
}
