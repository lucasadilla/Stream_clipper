/**
 * Production entrypoint for Railway/Docker.
 * Syncs the Prisma schema (additive tables/columns like FaceAnalysisJob)
 * before starting Next.js so deploys don't require a manual db push.
 */
const { spawnSync, spawn } = require("child_process");
const path = require("path");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    cwd: path.resolve(__dirname, ".."),
    shell: process.platform === "win32",
  });
  return result.status ?? 1;
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error("[start] DATABASE_URL is required");
  process.exit(1);
}

if (!process.env.DIRECT_URL?.trim()) {
  console.warn(
    "[start] DIRECT_URL is unset — prisma db push may fail against a pooled DATABASE_URL. Set DIRECT_URL to the direct Postgres connection."
  );
}

console.info("[start] Applying Prisma schema (db push)...");
const pushCode = run("npx", ["prisma", "db", "push", "--skip-generate"]);
if (pushCode !== 0) {
  console.error(
    `[start] prisma db push failed (exit ${pushCode}). Fix DATABASE_URL / DIRECT_URL and redeploy.`
  );
  process.exit(pushCode);
}
console.info("[start] Schema is up to date. Starting Next.js...");

const next = spawn("npx", ["next", "start"], {
  stdio: "inherit",
  env: process.env,
  cwd: path.resolve(__dirname, ".."),
  shell: process.platform === "win32",
});

next.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

next.on("error", (err) => {
  console.error("[start] failed to launch next start:", err);
  process.exit(1);
});
