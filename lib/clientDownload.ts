function toAbsoluteUrl(url: string): string {
  return url.startsWith("http")
    ? url
    : `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^\w.\-() ]/g, "_") || "short.mp4";
}

/**
 * Start a browser download immediately. The browser streams from the server
 * (fast start). Requires a recent user click on the same page.
 */
export function triggerDirectFileDownload(
  url: string,
  filename = "short.mp4"
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
  filename = "short.mp4",
  options?: FileDownloadOptions
): Promise<void> {
  if (options?.direct !== false) {
    const absoluteUrl = toAbsoluteUrl(url);
    const target = new URL(absoluteUrl);
    if (target.origin === window.location.origin) {
      const preflight = await fetch(absoluteUrl, {
        method: "HEAD",
        cache: "no-store",
      });
      if (
        !preflight.ok &&
        preflight.status !== 405 &&
        preflight.status !== 501
      ) {
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
    }
    triggerDirectFileDownload(url, filename);
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
