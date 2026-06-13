import { defineConfig } from 'vitest/config';

// Workspace-aware root config. Each entry below is a Vitest "project":
//
//  - The `node` project runs the default Node-environment tests across every
//    app/package that doesn't need a browser-like DOM (e.g. packages/protocol,
//    and the Node services in apps/hub and apps/room-server as they grow tests).
//  - The web app points at its own vitest.config.ts, which scopes the jsdom
//    environment + Testing Library setup to that package only.
//
// New Node packages are covered automatically by the glob; a package that needs
// a different environment can add its own vitest config and be listed here.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['{apps,packages}/*/src/**/*.test.ts'],
          exclude: ['apps/web/**'],
        },
      },
      './apps/web/vitest.config.ts',
    ],
  },
});
