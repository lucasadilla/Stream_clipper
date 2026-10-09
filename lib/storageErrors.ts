export function isNoSpaceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  return code === "ENOSPC" || /no space left on device|enospc|disk.?full/i.test(message);
}

export function noSpaceLeftError(): Error {
  return new Error(
    "Server storage is full. Automatic cleanup is running; wait a moment and try again. If it stays full, verify the Railway volume mount and capacity."
  );
}
