import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    exclude: ['tests/e2e/**', 'node_modules/**'],
    projects: [
      { extends: true, test: { name: 'engine', environment: 'node', include: ['tests/content-engine/**/*.test.ts'] } },
      { extends: true, test: { name: 'render', environment: 'jsdom', include: ['tests/content-engine/render/**/*.test.tsx'], setupFiles: ['tests/setup.render.ts'] } },
      { extends: true, test: { name: 'app', environment: 'node', include: ['tests/features/**/*.test.ts', 'tests/features/**/*.test.tsx', 'tests/lib/**/*.test.ts', 'tests/scripts/**/*.test.ts', 'tests/infra/**/*.test.ts'] } },
    ],
  },
});
