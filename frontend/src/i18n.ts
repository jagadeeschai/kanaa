/**
 * Kanaa's interface language: English or Tamil. Labels are written in English in the code and looked up here, so a
 * label without a Tamil entry simply stays English. The choice is remembered on this Mac; changing it reloads the page.
 * Keep both short: a label is a few words, a tip one plain sentence.
 */
import { TAMIL } from './i18n-ta.ts';

export type Language = 'en' | 'ta';
const KEY = 'kanaa-language';

function stored(): Language {
  try {
    return localStorage.getItem(KEY) === 'ta' ? 'ta' : 'en';
  } catch {
    return 'en';
  }
}

export const LANGUAGE: Language = stored();
if (typeof document !== 'undefined') document.documentElement.lang = LANGUAGE;

export function setLanguage(language: Language): void {
  try { localStorage.setItem(KEY, language); } catch { /* Private windows: stays English. */ }
  window.location.reload();
}

/** The label in the chosen language. `{name}` placeholders are filled from `values`. */
export function t(english: string, values?: Record<string, string | number>): string {
  let text = LANGUAGE === 'ta' ? TAMIL[english] ?? english : english;
  if (values) for (const [name, value] of Object.entries(values)) text = text.split(`{${name}}`).join(String(value));
  return text;
}

/** Both the label and its English, for search: a Tamil interface still finds settings by their English words. */
export const searchText = (english: string) => (LANGUAGE === 'ta' ? `${english} ${TAMIL[english] ?? ''}` : english);
