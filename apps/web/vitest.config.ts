import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// jsdom + Testing Library setup is scoped to the web package only; the Node
// packages keep the default Node test environment.
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
