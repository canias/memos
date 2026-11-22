import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "hotkeys-probe.spec.ts",
  workers: 1,
  reporter: "list",
  outputDir: "../../node_modules/.cache/hotkeys-probe-results",
  use: { baseURL: "http://localhost:3075", trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 900 } } }],
  webServer: {
    cwd: resolve(__dirname, "../.."),
    command: "pnpm exec vite --config tests/browser/hotkeys-probe.vite.config.mts",
    url: "http://localhost:3075/tests/browser/hotkeys-probe.html",
    reuseExistingServer: false,
  },
});
