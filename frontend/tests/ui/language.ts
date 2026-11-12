import { vi } from 'vitest';

/** Loads a module with Kanaa's interface in the given language (the choice is read once, when i18n loads). */
export async function inLanguage<T>(language: 'en' | 'ta', load: () => Promise<T>): Promise<T> {
  localStorage.setItem('kanaa-language', language);
  vi.resetModules();
  return load();
}
