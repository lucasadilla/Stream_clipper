import { prisma } from "../lib/db";
import { deleteStreamSession } from "../services/sessionCleanupService";
import { deleteSessionStorage, getSessionStorageDirs } from "../lib/storage";
import { existsSync } from "fs";
import { readdir } from "fs/promises";
import path from "path";
import { getStorageRoot } from "../lib/storage";

async function main() {
  const sessions = await prisma.streamSession.findMany({ select: { id: true, title: true } });
  console.log(`Deleting ${sessions.length} session(s) from database + disk...`);

  for (const s of sessions) {
    try {
      const result = await deleteStreamSession(s.id);
      console.log(`  ✓ ${s.title ?? s.id} — freed ${result.storageLabel}`);
    } catch (err) {
      console.error(`  ✗ ${s.id}:`, err instanceof Error ? err.message : err);
    }
  }

  // Orphan folders (tests / leftover) not tied to a DB row
  const roots = ["uploads", "frames", "renders"] as const;
  for (const kind of roots) {
    const dir = path.join(getStorageRoot(), kind);
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".gitkeep") continue;
      const id = entry.name;
      if (sessions.some((s) => s.id === id)) continue;
      try {
        await deleteSessionStorage(id);
        console.log(`  ✓ orphan ${kind}/${id}`);
      } catch (err) {
        console.error(`  ✗ orphan ${kind}/${id}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
