import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
