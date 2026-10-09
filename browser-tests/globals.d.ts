// Globals the test pages expose to the browser tests.
declare global {
  interface Window {
    copied: string[];
    pluginMessages: unknown[];
  }
}

export {};
