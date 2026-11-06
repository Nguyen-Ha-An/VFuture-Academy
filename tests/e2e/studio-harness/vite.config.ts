import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import { staffLegacyRedirects } from '../../../src/lib/staff-legacy-redirects';

const root = path.resolve(__dirname, '../../..');
export default defineConfig({
  root: __dirname,
  publicDir: path.join(root, 'public'),
  cacheDir: path.join(root, 'node_modules/.vite/studio-harness'),
  plugins: [react(), {
    name: 'canonical-studio-fixture-routing',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://fixture.local');
        for (const alias of staffLegacyRedirects.filter(alias => alias.source.startsWith('/studio/'))) {
          const names: string[] = [];
          const expression = new RegExp('^' + alias.source.replace(/:([a-zA-Z]+)/g, (_match, name: string) => { names.push(name); return '([^/]+)'; }) + '$');
          const match = url.pathname.match(expression);
          if (!match) continue;
          const destination = alias.destination.replace(/:([a-zA-Z]+)/g, (_match, name: string) => match[names.indexOf(name) + 1]!);
          response.statusCode = 307;
          response.setHeader('Location', destination + url.search);
          response.end();
          return;
        }
        const known = /^\/studio(?:\/(?:courses(?:\/[^/]+(?:\/notebooks\/[^/]+)?)?|bank(?:\/[^/]+)?|library|resources(?:\/[^/]+)?|opportunities(?:\/[^/]+)?|projects(?:\/[^/]+)?|media|reviews(?:\/[^/]+)?|mcp|connect\/authorize))?$/.test(url.pathname);
        if (url.pathname.startsWith('/studio/') && !known) {
          response.statusCode = 404;
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><html lang="en"><title>Unknown Studio fixture route</title><h1>Unknown Studio fixture route</h1><p>This route is not represented by the local Studio harness.</p></html>');
          return;
        }
        next();
      });
    },
  }],
  resolve: { alias: {
    '@': path.join(root, 'src'),
    'next/navigation': path.join(__dirname, 'src/next-navigation.ts'),
    'next/link': path.join(__dirname, 'src/next-link.tsx'),
    'next/dynamic': path.join(__dirname, 'src/next-dynamic.tsx'),
    'next/image': path.join(__dirname, 'src/next-image.tsx'),
  } },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
});
