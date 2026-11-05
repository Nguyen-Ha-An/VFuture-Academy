import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
const root=path.resolve(__dirname,'../../..');
// A separate, explicit fixture process can exercise Azure-only account controls. Never reads credentials.
const fixtureBackend=process.env.ACADEMY_FIXTURE_BACKEND==='azure'?'azure':'supabase';
export default defineConfig({root:__dirname,publicDir:path.join(root,'public'),cacheDir:path.join(root,`node_modules/.vite/admin-harness-${fixtureBackend}`),plugins:[react()],define:{'process.env.NEXT_PUBLIC_ACADEMY_BACKEND':JSON.stringify(fixtureBackend)},resolve:{alias:{
  '@':path.join(root,'src'),'next/navigation':path.join(__dirname,'../studio-harness/src/next-navigation.ts'),
  'next/link':path.join(__dirname,'../studio-harness/src/next-link.tsx'),
  'next/dynamic':path.join(__dirname,'../studio-harness/src/next-dynamic.tsx'),
  'next/image':path.join(__dirname,'../studio-harness/src/next-image.tsx'),
}},css:{postcss:{plugins:[tailwindcss()]}},server:{host:'127.0.0.1',port:4176,strictPort:true}});
