// Test page: the preview (Joplin's note viewer) with the plugin's rendering,
// Joplin's checkbox markup and styles, and the webview script loaded after
// the note like a plugin asset.
import {
  fakePlugin,
  joplinCheckboxes,
  joplinListCss,
  joplinPreviewCss,
  pluginCss,
  renderWithPlugin,
  webviewScriptUrl,
} from "./joplin.ts";

declare global {
  interface Window {
    mountPreview(markdown: string, hidden?: string[]): Promise<void>;
  }
}

window.mountPreview = function (markdown, hidden = []) {
  const stored: Record<string, boolean> = {};
  for (const listId of hidden) stored[listId] = true;
  const plugin = fakePlugin(stored);
  window.pluginMessages = plugin.messages;
  window.webviewApi = { postMessage: plugin.postMessage };

  const style = document.createElement("style");
  style.textContent = joplinListCss + joplinPreviewCss + pluginCss();
  document.head.appendChild(style);
  document.getElementById("note")!.innerHTML = joplinCheckboxes(
    renderWithPlugin(markdown),
    "preview",
  );

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = webviewScriptUrl();
    script.onload = () => setTimeout(resolve, 100);
    document.head.appendChild(script);
  });
};
