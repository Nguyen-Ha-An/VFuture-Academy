#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(new URL('../public/studio-workers/', import.meta.url), { recursive: true });
// Turbopack 15 treats new URL('worker.ts', import.meta.url) as a raw asset.
// Build a self-contained JavaScript worker, with no runtime chunks or external imports.
await build({
  absWorkingDir: root,
  entryPoints: ['src/features/studio/ui/workspace-analysis.worker.ts'],
  outfile: 'public/studio-workers/workspace-analysis.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('Studio analysis worker bundled.');
