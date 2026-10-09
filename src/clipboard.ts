// ============================================================================
// CheckboxHide - clipboard.ts
// ============================================================================
// Shared clipboard helper for the "copy checklist" button: writes text via
// the async Clipboard API when available, falling back to execCommand("copy")
// for webviews/editors where that API is blocked or unavailable. Also exports
// the copy/checkmark icon markup and a small "flash to a checkmark" success
// affordance shared by every surface's copy button.
//
// checkboxRendererBrowser.ts keeps its own inline duplicate of this logic
// rather than importing this module - see that file's header comment.
// ============================================================================

const COPY_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const CHECK_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12"></polyline></svg>';

// Puts the text into the "copy" event that execCommand("copy") fires.
// Listening on the window in the capture phase runs before any editor's own
// copy handling (the rich text editor copies its current selection), and
// stopping the event keeps those handlers from overwriting the text.
function fallbackCopy(text: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const onCopy = function (event: ClipboardEvent): void {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("copy", onCopy, true);
  try {
    // execCommand("copy") does nothing in a document without focus, e.g. the
    // rich text editor when the copy button is the first thing clicked (the
    // bar keeps presses from focusing the editor).
    if (!document.hasFocus()) window.focus();
    document.execCommand("copy");
  } catch (error) {
    console.warn("CheckboxHide: fallback clipboard copy failed:", error);
  } finally {
    window.removeEventListener("copy", onCopy, true);
  }
}

function copyToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {
    return navigator.clipboard.writeText(text).catch(function () {
      fallbackCopy(text);
    });
  }
  fallbackCopy(text);
  return Promise.resolve();
}

function flashCopied(button: { innerHTML: string } | null): void {
  if (!button) return;
  button.innerHTML = CHECK_ICON;
  setTimeout(function () {
    button.innerHTML = COPY_ICON;
  }, 1200);
}

export default {
  copyToClipboard: copyToClipboard,
  flashCopied: flashCopied,
  COPY_ICON: COPY_ICON,
  CHECK_ICON: CHECK_ICON,
};
