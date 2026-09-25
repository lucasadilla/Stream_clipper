import { videoDownloadFilename } from "@/lib/downloadFilename";

function toAbsoluteUrl(url: string): string {
  return url.startsWith("http")
    ? url
    : `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;
}

function sanitizeFilename(filename: string): string {
  const extension = filename.toLowerCase().endsWith(".zip") ? ".zip" : ".mp4";
  return extension === ".mp4"
    ? videoDownloadFilename(filename)
    : `${filename
        .replace(/\.zip$/i, "")
        .replace(/[^\w\-() ]/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "Clipper Export"}${extension}`;
}

async function assertDownloadReady(absoluteUrl: string): Promise<void> {
  const target = new URL(absoluteUrl);
  if (target.origin !== window.location.origin) return;
  const preflight = await fetch(absoluteUrl, {
    method: "HEAD",
    cache: "no-store",
  });
  if (preflight.ok || preflight.status === 405 || preflight.status === 501) return;

  let message = `Download failed (${preflight.status})`;
  try {
    const detail = await fetch(absoluteUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const data = (await detail.json()) as { error?: string };
    if (data.error) message = data.error;
  } catch {
    // Keep the status-based fallback when the endpoint has no JSON body.
  }
  throw new Error(message);
}

export interface PreparedFileDownload {
  start: (url: string, filename?: string) => Promise<void>;
  cancel: () => void;
}

/**
 * Reserve a same-page navigation target during the user's click. Once a long
 * render finishes, navigating the top-level tab to a verified attachment URL
 * is handled as a normal file download and does not depend on transient user
 * activation or a hidden iframe being allowed to start downloads.
 */
export function prepareFileDownload(): PreparedFileDownload {
  const anchor = document.createElement("a");
  anchor.setAttribute("aria-hidden", "true");
  anchor.style.display = "none";
  anchor.target = "_self";
  document.body.appendChild(anchor);
  let started = false;

  const cancel = () => {
    if (anchor.isConnected) anchor.remove();
  };

  return {
    async start(url, filename = "Clipper Export.mp4") {
      if (started) throw new Error("This download has already started");
      started = true;
      const absoluteUrl = toAbsoluteUrl(url);
      try {
        await assertDownloadReady(absoluteUrl);
        const target = new URL(absoluteUrl);
        target.searchParams.set("download", "1");
        target.searchParams.set("filename", sanitizeFilename(filename));
        if (!anchor.isConnected) document.body.appendChild(anchor);
        anchor.href = target.toString();
        anchor.click();
        window.setTimeout(cancel, 0);
      } catch (error) {
        cancel();
        throw error;
      }
    },
    cancel,
  };
}

/**
 * Start a browser download immediately. The browser streams from the server
 * (fast start). Requires a recent user click on the same page.
 */
export function triggerDirectFileDownload(
  url: string,
  filename = "Clipper Export.mp4"
): void {
  const anchor = document.createElement("a");
  anchor.href = toAbsoluteUrl(url);
  anchor.download = sanitizeFilename(filename);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export interface FileDownloadOptions {
  /** When true (default), stream via anchor click instead of fetch+blob. */
  direct?: boolean;
}

/** Trigger a browser file download from an API URL. */
export async function triggerFileDownload(
  url: string,
  filename = "Clipper Export.mp4",
  options?: FileDownloadOptions
): Promise<void> {
  if (options?.direct !== false) {
    const prepared = prepareFileDownload();
    await prepared.start(url, filename);
    return;
  }

  const safeName = sanitizeFilename(filename);
  const res = await fetch(toAbsoluteUrl(url));
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      const text = await res.text().catch(() => "");
      if (text) message = text.slice(0, 200);
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = safeName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
