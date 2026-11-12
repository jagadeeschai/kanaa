import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no layout: scrolling a list item into view is a no-op here.
Element.prototype.scrollIntoView = function scrollIntoView() {};
afterEach(() => { cleanup(); localStorage.clear(); });

// jsdom has no innerText; in these tests it is the element's text.
if (!('innerText' in HTMLElement.prototype) || Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText') === undefined) {
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) { return this.textContent ?? ''; },
    set(this: HTMLElement, value: string) { this.textContent = value; },
  });
}
