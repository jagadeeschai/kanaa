/**
 * What went wrong, in plain words. Messages Kanaa writes for people are shown as they are (in Tamil when there is a
 * translation). Technical ones (a dropped connection, a server crash, a timeout) become a sentence saying what to do,
 * with the original kept for Details.
 */
import { t } from '../i18n.ts';

const PLAIN: [RegExp, string][] = [
  [/failed to fetch|networkerror|load failed|econnrefused|err_connection/i, 'Kanaa could not reach its engine. Wait a moment and try again; if it keeps happening, restart Kanaa.'],
  [/timed? ?out|timeout/i, 'This took too long. Try again, or try a shorter clip.'],
  [/\b5\d\d\b|internal server error|traceback|exception/i, 'Something went wrong inside Kanaa. Try again; your project is saved.'],
  [/\b413\b|too large|payload/i, 'This file is too big. Try a smaller or shorter one.'],
  [/\b40[13]\b|not allowed|forbidden|unauthori[sz]ed/i, 'Kanaa is not allowed to do that here. Check AI settings or permissions.'],
  [/quota|rate limit|429/i, 'The AI service is busy or out of credit. Wait a little, or check AI settings.'],
  [/unexpected token|json|syntaxerror|undefined is not|cannot read propert/i, 'Kanaa got an answer it did not understand. Try again; your project is saved.'],
];

/** The words to show, and the original when it was changed. */
export function explainError(message: string): { text: string; details: string | null } {
  const raw = message.replace(/^Kanaa said:\s*/, '').trim();
  for (const [pattern, plain] of PLAIN) if (pattern.test(raw)) return { text: t(plain), details: raw };
  return { text: t(raw), details: null };
}
