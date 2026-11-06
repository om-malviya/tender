import { defineConfig } from "vitest/config";

// Only our own TypeScript tests (the Solidity libraries under contracts/lib ship their own JS tests).
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "server/test/**/*.test.ts", "agent/test/**/*.test.ts"],
  },
});
