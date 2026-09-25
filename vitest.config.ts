import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Keep Windows sandboxed paths stable instead of resolving every parent
    // directory before loading the test runner and aliases.
    preserveSymlinks: true,
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
