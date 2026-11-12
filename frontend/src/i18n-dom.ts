/**
 * In Tamil, Kanaa's own interface text is translated as it appears: any text or tooltip that is exactly an English
 * label in the Tamil table becomes its Tamil. Whole labels only, so names, titles and anything typed stay as they are.
 * Text inside inputs, text boxes, editable areas and anything marked data-keep-language is never touched.
 */
import { LANGUAGE } from './i18n';
import { TAMIL } from './i18n-ta';

const ATTRIBUTES = ['data-tip', 'title', 'placeholder', 'aria-label'];
const SKIP = 'input, textarea, select, [contenteditable="true"], [data-keep-language], .ed-name, .ed-selection-name, canvas, svg text';

// Labels made from a name, such as "Hide Text": the name stays, the words around it change.
const PATTERNS: [RegExp, string][] = [
  [/^Open (.+)$/, '$1 திற'], [/^More actions for (.+)$/, '$1: மேலும்'], [/^Add (.+) as an overlay$/, '$1 மேலடுக்காகச் சேர்'],
  [/^Hide (.+)$/, '$1 மறை'], [/^Show (.+)$/, '$1 காட்டு'], [/^Mute (.+)$/, '$1 ஒலியடக்கு'], [/^Unmute (.+)$/, '$1 ஒலி இயக்கு'],
  [/^Lock (.+)$/, '$1 பூட்டு'], [/^Unlock (.+)$/, '$1 திற'], [/^Delete (.+) layer$/, '$1 அடுக்கை நீக்கு'],
  [/^Collapse (.+) layer$/, '$1 அடுக்கைச் சுருக்கு'], [/^Expand (.+) layer$/, '$1 அடுக்கை விரி'],
  [/^Bring (.+) forward$/, '$1 முன்னே'], [/^Send (.+) back$/, '$1 பின்னே'],
];

function pattern(text: string): string | undefined {
  for (const [match, tamil] of PATTERNS) if (match.test(text)) return text.replace(match, (_, name: string) => tamil.replace('$1', TAMIL[name] ?? name));
  return undefined;
}

function translated(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return null;
  const tamil = TAMIL[trimmed] ?? pattern(trimmed);
  // Only a real change: writing the same text again would count as a change and wake this up again, forever.
  return tamil && tamil !== trimmed ? text.replace(trimmed, tamil) : null;
}

function translate(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    const parent = root.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const next = translated(root.textContent ?? '');
    if (next !== null) root.textContent = next;
    return;
  }
  if (!(root instanceof Element) || root.closest(SKIP)) return;
  for (const name of ATTRIBUTES) {
    const value = root.getAttribute(name);
    const next = value && translated(value);
    if (next) root.setAttribute(name, next);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (const name of ATTRIBUTES) {
        const value = (node as Element).getAttribute(name);
        const next = value && translated(value);
        if (next) (node as Element).setAttribute(name, next);
      }
    } else {
      const next = translated(node.textContent ?? '');
      if (next !== null) node.textContent = next;
    }
  }
}

export function startTranslating(): void {
  if (LANGUAGE !== 'ta' || typeof MutationObserver === 'undefined') return;
  translate(document.body);
  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'characterData') translate(change.target);
      else if (change.type === 'attributes') translate(change.target);
      else change.addedNodes.forEach(translate);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
}
