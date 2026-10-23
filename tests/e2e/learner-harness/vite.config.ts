import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';

const root = path.resolve(__dirname, '../../..');
const fixture = path.join(__dirname, 'src/data.ts');
export default defineConfig({
  root: __dirname,
  cacheDir: path.join(root, 'node_modules/.vite/learner-harness'),
  plugins: [react()],
  resolve: { alias: [
    // The bench dashboard imports its activity series relatively and marks server modules.
    { find: /^\.\/activity\.server$/, replacement: fixture },
    { find: /^server-only$/, replacement: path.join(root, 'tests/e2e/student-harness/src/server-only.ts') },
    { find: 'next/navigation', replacement: path.join(__dirname, 'src/next-navigation.ts') },
    { find: 'next/link', replacement: path.join(__dirname, 'src/next-link.tsx') },
    { find: 'next-intl/server', replacement: path.join(__dirname, 'src/i18n.ts') },
    ...['@/lib/api', '@/lib/auth', '@/features/catalog/service', '@/features/learner/summary', '@/features/progress/service', '@/features/submissions/service', '@/features/me/service', '@/features/skills/service', '@/features/xp/service'].map((find) => ({ find, replacement: fixture })),
    { find: '@/features/learner/ui/ItemPlayer', replacement: path.join(__dirname, 'src/item-player.tsx') },
    { find: '@', replacement: path.join(root, 'src') },
  ] },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: '127.0.0.1', port: 4176, strictPort: true },
});
