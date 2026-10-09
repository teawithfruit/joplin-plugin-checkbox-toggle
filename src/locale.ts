// ============================================================================
// CheckboxHide - locale.ts
// ============================================================================
// Tiny shared i18n helper for the toggle button's visible label and
// aria-label. Shows German when the host's language is German, English
// otherwise. All surfaces (preview, rich text editor, CM6 and CM5 markdown
// editors) run inside Electron windows that expose `navigator`, so that is
// used to detect the language Joplin itself is running in; environments
// without it (e.g. this module's unit tests) default to English.
// ============================================================================

const EN = {
  hide: "Hide completed",
  show: "Show completed",
  ariaToggle: "Show or hide completed tasks",
  copyAria: "Copy checklist as Markdown",
};

export type StringKey = keyof typeof EN;
export type Language = "en" | "de";

const STRINGS: Record<Language, Record<StringKey, string>> = {
  en: EN,
  de: {
    hide: "Erledigte ausblenden",
    show: "Erledigte einblenden",
    ariaToggle: "Erledigte Aufgaben ein- oder ausblenden",
    copyAria: "Checkliste als Markdown kopieren",
  },
};

function detectLanguage(): Language {
  const language =
    (typeof navigator !== "undefined" && navigator.language) || "";
  return language.toLowerCase().indexOf("de") === 0 ? "de" : "en";
}

function t(key: StringKey): string {
  return STRINGS[detectLanguage()][key];
}

export default { t: t, detectLanguage: detectLanguage };
