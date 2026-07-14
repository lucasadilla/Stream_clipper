"use client";

import { useRef, useState } from "react";

interface SourceUploadFallbackProps {
  sessionId: string;
  message: string;
  onUploaded: () => void | Promise<void>;
}

export function SourceUploadFallback({
  sessionId,
  message,
  onUploaded,
}: SourceUploadFallbackProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setProgress(0);
    try {
      await new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", `/api/sessions/${sessionId}/upload-source`);
        request.setRequestHeader("content-type", file.type || "video/mp4");
        request.setRequestHeader("x-file-name", encodeURIComponent(file.name));
        request.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        request.onerror = () => reject(new Error("The upload connection failed."));
        request.onload = () => {
          let response: { error?: string } = {};
          try {
            response = JSON.parse(request.responseText) as { error?: string };
          } catch {
            // A proxy may return a plain-text error page.
          }
          if (request.status >= 200 && request.status < 300) resolve();
          else reject(new Error(response.error || `Upload failed (${request.status}).`));
        };
        request.send(file);
      });
      setProgress(100);
      await onUploaded();
    } catch (uploadError) {
      setProgress(null);
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed."
      );
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mx-4 mt-3 flex shrink-0 flex-col gap-3 border border-[#8fcb55]/35 bg-[#071007] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">Direct capture unavailable</p>
        <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">
          {error ?? message} Upload a VOD you have the right to process.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {progress !== null && (
          <span className="min-w-12 text-right text-xs font-semibold text-[var(--color-accent)]">
            {progress < 100 ? `${progress}%` : "Ready"}
          </span>
        )}
        <button
          type="button"
          disabled={progress !== null && progress < 100}
          onClick={() => inputRef.current?.click()}
          className="border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2 text-xs font-bold text-black transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-60"
        >
          {progress !== null && progress < 100 ? "Uploading" : "Upload VOD"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
    </div>
  );
}
