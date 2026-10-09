import { defineConfig, devices } from "@playwright/test";

// Browser tests for what jsdom cannot check: layout (click accuracy, Button
// bar alignment) and real editors (CodeMirror 6, TinyMCE configured like
// Joplin's rich text editor). Run with `npm run test:browser`.
export default defineConfig({
  testDir: "./browser-tests",
  globalSetup: "./browser-tests/globalSetup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1000, height: 900 },
    // execCommand("copy") only fires its copy event with clipboard access.
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [{ name: "chromium" }],
});
