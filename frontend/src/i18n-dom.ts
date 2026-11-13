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
  [/^Open (.+)$/, '$1 திற'], [/^Line (\d+) start$/, 'வரி $1 தொடக்கம்'], [/^Line (\d+) end$/, 'வரி $1 முடிவு'], [/^Line (\d+) position$/, 'வரி $1 இடம்'], [/^Lyric line (\d+)$/, 'பாடல் வரி $1'],
  [/^Remove lyric line (\d+)$/, 'பாடல் வரி $1 நீக்கு'], [/^Remove image (\d+)$/, 'படம் $1 நீக்கு'], [/^Move image (\d+) earlier$/, 'படம் $1 முன்னே'], [/^Cut (\d+): add a transition$/, 'வெட்டு $1: மாற்றம் சேர்'],
  [/^Earlier by ([\d.]+) seconds$/, '$1 விநாடி முன்னே'], [/^Later by ([\d.]+) seconds$/, '$1 விநாடி பின்னே'], [/^✓ Saved · step (\d+) of (\d+)$/, '✓ சேமிக்கப்பட்டது · படி $1 / $2'], [/^✓ (\d+) timed lyric lines$/, '✓ நேரமிட்ட $1 வரிகள்'],
  [/^(.+) layer$/, '$1 அடுக்கு'], [/^Up to (\d+) images, shown in order for equal portions of the song\. ([\d.]+) seconds each\.$/, 'அதிகபட்சம் $1 படங்கள், பாடலின் சம பகுதிகளுக்கு வரிசையாக; ஒவ்வொன்றும் $2 விநாடி.'], [/^Appearance: (.+)\. Change$/, 'திரை வண்ணம்: $1. மாற்று'], [/^Restored your saved project, on (.+)\.$/, 'சேமித்த திட்டம் மீட்கப்பட்டது: $1.'],  [/^Add title: (.+)$/, 'தலைப்பு சேர்: $1'], [/^Guide: (.+)$/, 'வழிகாட்டி: $1'], [/^Layer settings: (.+)$/, 'அடுக்கு அமைப்புகள்: $1'], [/^Fix lyric timing: (.+)$/, 'வரி நேரம் சரிசெய்: $1'], [/^More actions for (.+)$/, '$1: மேலும்'], [/^Add (.+) as an overlay$/, '$1 மேலடுக்காகச் சேர்'],
  [/^Hide (.+)$/, '$1 மறை'], [/^Show (.+)$/, '$1 காட்டு'], [/^Mute (.+)$/, '$1 ஒலியடக்கு'], [/^Unmute (.+)$/, '$1 ஒலி இயக்கு'],
  [/^Lock (.+)$/, '$1 பூட்டு'], [/^Unlock (.+)$/, '$1 திற'], [/^Delete (.+) layer$/, '$1 அடுக்கை நீக்கு'],
  [/^Collapse (.+) layer$/, '$1 அடுக்கைச் சுருக்கு'], [/^Expand (.+) layer$/, '$1 அடுக்கை விரி'],
  [/^Link (.+)$/, '$1 இணை'], [/^Unlink (.+)$/, '$1 பிரி'], [/^(.+) layer menu$/, '$1 அடுக்கு மெனு'], [/^(.+) layer settings$/, '$1 அடுக்கு அமைப்புகள்'], [/^Bring (.+) forward$/, '$1 முன்னே'], [/^Send (.+) back$/, '$1 பின்னே'],
];

function pattern(text: string): string | undefined {
  for (const [match, tamil] of PATTERNS) {
    const found = match.exec(text);
    // Each $n is the matching part, itself in Tamil when it is a known label (a layer called Text says உரை அடுக்கு).
    if (found) return tamil.replace(/\$(\d)/g, (_, n: string) => { const part = found[Number(n)] ?? ''; return TAMIL[part] ?? part; });
  }
  return undefined;
}

function translated(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return null;
  const tamil = TAMIL[trimmed] ?? pattern(trimmed);
  // Only a real change: writing the same text again would count as a change and wake this up again, forever.
  return tamil && tamil !== trimmed ? text.replace(trimmed, tamil) : null;
}

/** The labels of an element (tooltip, placeholder, accessible name), never what it holds. */
function translateLabels(element: Element): void {
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    const next = value && translated(value);
    if (next) element.setAttribute(name, next);
  }
}

// Boxes people type into: their labels are translated, their contents never.
const TYPED = 'input, textarea, select, [contenteditable="true"]';

function translate(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    const parent = root.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const next = translated(root.textContent ?? '');
    if (next !== null) root.textContent = next;
    return;
  }
  if (!(root instanceof Element)) return;
  if (root.closest(SKIP)) { if (root.matches(TYPED) && !root.closest('[data-keep-language]')) translateLabels(root); return; }
  translateLabels(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE || !(node as Element).matches(SKIP)) return NodeFilter.FILTER_ACCEPT;
      if ((node as Element).matches(TYPED) && !(node as Element).closest('[data-keep-language]')) translateLabels(node as Element);
      return NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      translateLabels(node as Element);
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
