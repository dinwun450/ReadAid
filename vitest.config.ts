import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
  resolve: { alias: { "@": root, "server-only": `${root}test/server-only.ts` } },
});
