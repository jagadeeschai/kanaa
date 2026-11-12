import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no layout: scrolling a list item into view is a no-op here.
Element.prototype.scrollIntoView = function scrollIntoView() {};
afterEach(() => { cleanup(); localStorage.clear(); });
