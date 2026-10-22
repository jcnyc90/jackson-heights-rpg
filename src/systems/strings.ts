import en from '../data/strings/en.json';

// All player-facing text lives in src/data/strings/<lang>.json, keyed by stable IDs (DESIGN.md 2.6).
const STRINGS: Readonly<Record<string, string>> = en;

const warned = new Set<string>();

/**
 * Looks up a string by ID and fills `{name}`-style placeholders from `params`.
 * A missing ID renders as the ID itself so it's easy to spot; dev builds also warn once per ID.
 */
export function t(id: string, params?: Record<string, string | number>): string {
  const text = STRINGS[id];
  if (text === undefined) {
    if (import.meta.env.DEV && !warned.has(id)) {
      warned.add(id);
      console.warn(`[strings] missing string "${id}"`);
    }
    return id;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

/** Sets the page title and <html lang> from the strings file. */
export function applyDocumentStrings(): void {
  document.documentElement.lang = t('app.lang');
  document.title = t('app.title');
}
