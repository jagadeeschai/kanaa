// Interface tests: the editor's panels and controls rendered in a simulated page (jsdom), in English and Tamil.
// The older model tests run with `npm test` (node --test); these run with `npm run test:ui`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/ui/**/*.test.tsx'],
    setupFiles: ['tests/ui/setup.ts'],
    restoreMocks: true,
  },
});
