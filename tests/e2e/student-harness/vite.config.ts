import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';

const root = path.resolve(__dirname, '../../..');
export default defineConfig({
  root: __dirname,
  publicDir: path.join(root, 'public'),
  cacheDir: path.join(__dirname, '.cache'),
  plugins: [react()],
  // Next normally injects this constant. Keep the real Image module's default configuration.
  define: { 'process.env.__NEXT_IMAGE_OPTS': 'undefined' },
  resolve: { alias: [
    // Bench fixtures: the dashboard imports its activity series relatively.
    { find: /^\.\/activity\.server$/, replacement: path.join(__dirname, 'src/learner-activity.ts') },
    { find: /^server-only$/, replacement: path.join(__dirname, 'src/server-only.ts') },
    ...Object.entries({
    'next/link': path.join(__dirname, 'src/next-link.tsx'),
    'next/navigation': path.join(__dirname, 'src/next-navigation.ts'),
    'next-intl/server': path.join(__dirname, 'src/server-intl.ts'),
    '@/lib/auth': path.join(__dirname, 'src/server-auth.ts'),
    '@/features/catalog/service': path.join(__dirname, 'src/catalog-service.ts'),
    '@/features/learner/summary': path.join(__dirname, 'src/learner-summary.ts'),
    '@/features/learner/ui/EnrollButton': path.join(__dirname, 'src/enroll-button.tsx'),
    '@/features/profile/service': path.join(__dirname, 'src/profile-service.ts'),
    '@/features/projects/service': path.join(__dirname, 'src/projects-service.ts'),
    '@/features/opportunities/service': path.join(__dirname, 'src/opportunities-service.ts'),
    '@/features/me/service': path.join(__dirname, 'src/leaderboard-service.ts'),
    '@/features/xp/service': path.join(__dirname, 'src/leaderboard-service.ts'),
    '@/features/skills/service': path.join(__dirname, 'src/skills-service.ts'),
    '@/features/resources/service': path.join(__dirname, 'src/resources-service.ts'),
    '@/features/ecosystem/context': path.join(__dirname, 'src/ecosystem-context.ts'),
    '@/lib/supabase/server': path.join(__dirname, 'src/no-database.ts'),
    '@/lib/api': path.join(root, 'src/lib/api-error.ts'),
    '@': path.join(root, 'src'),
  }).map(([find, replacement]) => ({ find, replacement })),
  ] },
  css: { postcss: { plugins: [tailwindcss({ base: path.join(root, 'src') })] } },
  server: { host: '127.0.0.1', port: 4180, strictPort: true, hmr: false, watch: { ignored: ['**/artifacts/**', '**/.cache/**'] } },
});
