import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';

const root = path.resolve(__dirname, '../../..');

export default defineConfig({
  root: __dirname,
  // Never load application environment files or expose real public credentials.
  envDir: __dirname,
  publicDir: false,
  cacheDir: path.join(__dirname, '.cache'),
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@/features/auth/onboarding-actions',
        replacement: path.join(__dirname, 'src/onboarding-actions.ts'),
      },
      { find: '@', replacement: path.join(root, 'src') },
    ],
  },
  css: { postcss: { plugins: [tailwindcss({ base: path.join(root, 'src') })] } },
  server: {
    host: '127.0.0.1',
    port: 4184,
    strictPort: true,
    hmr: false,
    watch: { ignored: ['**/artifacts/**', '**/.cache/**'] },
  },
});
