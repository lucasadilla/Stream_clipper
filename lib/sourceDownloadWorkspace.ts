import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { isNoSpaceError, noSpaceLeftError } from "@/lib/storageErrors";

/** Keep split tracks and the merge copy off the persistent media volume. */
export async function downloadSourceInWorkspace(
  destination: string,
  download: (stagedOutput: string) => Promise<void>
): Promise<void> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-source-"));
  const stagedOutput = path.join(workspace, "source.mp4");
  const pendingOutput = `${destination}.${randomUUID()}.tmp`;
  try {
    await download(stagedOutput);
    const size = (await fs.stat(stagedOutput)).size;
    const disk = await fs.statfs(path.dirname(destination));
    // Leave room for transcription and previews after publishing the source.
    if (disk.bavail * disk.bsize < size + 256 * 1024 * 1024) {
      throw noSpaceLeftError();
    }
    await fs.copyFile(stagedOutput, pendingOutput);
    await fs.rename(pendingOutput, destination);
  } catch (error) {
    if (isNoSpaceError(error)) throw noSpaceLeftError();
    throw error;
  } finally {
    await fs.unlink(pendingOutput).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true });
  }
}
