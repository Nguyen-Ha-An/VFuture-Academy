import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { build } from 'esbuild';
import { resolve } from 'node:path';
let server: Server;
let origin: string;

test.beforeAll(async () => {
  const bundle = (await build({
    stdin: { contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {createPortal} from 'react-dom';
      import {NextIntlClientProvider} from 'next-intl';
      import {AdminSessionGuard} from './src/features/admin/components/AdminSessionGuard';
      import messages from './src/messages/en.json';
      window.fixtureRouter={replace:destination=>{window.fixtureDestination=destination;},refresh:()=>{}};
      function Workspace(){
        const [count,setCount]=useState(0);
        return <><main><h1>Authorized workspace</h1><input aria-label="Answer" defaultValue="Unsaved answer"/><button onClick={()=>setCount(value=>value+1)}>Action {count}</button></main>{createPortal(<aside><p>Private portal</p></aside>,document.body)}</>;
      }
      // Mirror the production fragment: content and recovery status are direct
      // body siblings, with no Testing Library or application wrapper container.
      createRoot(document.body).render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="original-actor" destination="/app"><Workspace/></AdminSessionGuard></NextIntlClientProvider>);
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NEXT_PUBLIC_ACADEMY_BACKEND': '"azure"', 'process.env.NODE_ENV': '"production"' },
    alias: { '@': resolve(process.cwd(), 'src') },
    plugins: [{ name: 'guard-fixture-boundaries', setup(build) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'router', namespace: 'guard-fixture' }));
      build.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: 'supabase', namespace: 'guard-fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'guard-fixture' }, args => ({ contents: args.path === 'router' ? 'export function useRouter(){return window.fixtureRouter;}' : 'export function supabaseBrowser(){throw new Error("Unexpected legacy identity path");}', loader: 'js' }));
    } }],
  })).outputFiles[0].text;
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const url = new URL(request.url!, 'http://localhost');
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle); return; }
    if (url.pathname === '/api/v1/auth/session') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ userId: 'original-actor' })); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Session guard contract</title></head><body><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local test server');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(done => server ? server.close(() => done()) : done()); });

test('keeps direct-body content accessible and clickable after initial validation and outage retry', async ({ page }) => {
  await page.clock.install();
  let request = 0;
  await page.route('**/api/v1/auth/session', route => {
    request++;
    return route.fulfill({ status: request === 2 ? 503 : 200, contentType: 'application/json', body: JSON.stringify({ userId: 'original-actor' }) });
  });
  await page.goto(`${origin}/app/courses/one`);
  const action = page.getByRole('button', { name: 'Action 0', exact: true });
  await expect(action).toBeVisible();
  await expect.poll(() => action.evaluate(node => node.closest('[inert], [hidden], [aria-hidden="true"]') === null)).toBe(true);
  await action.click();
  await expect(page.getByRole('button', { name: 'Action 1', exact: true })).toBeVisible();
  const answer = page.getByRole('textbox', { name: 'Answer' });
  await answer.fill('Unsaved lesson answer');
  await answer.evaluate(node => { node.focus(); (node as HTMLInputElement).setSelectionRange(2, 7, 'backward'); (window as unknown as { savedEditor: Element }).savedEditor = node; });
  await page.clock.fastForward(300_000);
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByText('Private portal')).toBeHidden();
  await retry.click();
  await expect(answer).toBeVisible();
  await expect(answer).toBeFocused();
  await expect(answer).toHaveValue('Unsaved lesson answer');
  expect(await answer.evaluate(node => node === (window as unknown as { savedEditor: Element }).savedEditor)).toBe(true);
  expect(await answer.evaluate(node => node.closest('[inert], [hidden], [aria-hidden="true"]') === null)).toBe(true);
  expect(await answer.evaluate(node => [(node as HTMLInputElement).selectionStart, (node as HTMLInputElement).selectionEnd, (node as HTMLInputElement).selectionDirection])).toEqual([2, 7, 'backward']);
  await expect(page.getByText('Private portal')).toBeVisible();
  await page.getByRole('button', { name: 'Action 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Action 2', exact: true })).toBeVisible();
});

test('reuses a fresh session across tab switches and checks a stale return without polling', async ({ page }) => {
  await page.clock.install();
  let requests = 0;
  await page.route('**/api/v1/auth/session', route => {
    requests++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ userId: 'original-actor' }) });
  });
  await page.goto(`${origin}/app/courses/one`);
  const answer = page.getByRole('textbox', { name: 'Answer' });
  await expect(answer).toBeVisible();
  await answer.fill('Unsaved lesson');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(answer).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
  }
  expect(requests).toBe(1);
  await page.clock.fastForward(600_000);
  expect(requests).toBe(1);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => requests).toBe(2);
  await expect(answer).toBeVisible();
  await expect(answer).toHaveValue('Unsaved lesson');
  await page.getByRole('button', { name: 'Action 0', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Action 1', exact: true })).toBeVisible();
  expect(requests).toBe(2);
});

test('still conceals old body content and portals after a confirmed actor change', async ({ page }) => {
  let request = 0;
  await page.route('**/api/v1/auth/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ userId: ++request === 1 ? 'original-actor' : 'another-actor' }) }));
  await page.goto(`${origin}/app/courses/one`);
  await expect(page.getByRole('heading', { name: 'Authorized workspace' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'vfuture:auth:changed', newValue: 'another-login' })));
  await expect(page.getByRole('heading', { name: 'Authorized workspace' })).toHaveCount(0);
  await expect(page.getByText('Private portal')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { fixtureDestination: string }).fixtureDestination)).toBe('/app');
});
