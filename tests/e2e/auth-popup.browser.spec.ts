import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { buildSync } from 'esbuild';
import { resolve } from 'node:path';
let server: Server; let origin: string;
// The harness bundles the real production popup controller/completion functions.
// Only the external provider and server-session boundary are simulated locally.
test.beforeAll(async () => {
  const bundle = buildSync({ stdin: { contents: `
    import {startAuthPopup} from './src/lib/identity/popup-client';
    import {completeAuthPopup} from './src/lib/identity/popup-completion';
    let current;
    document.querySelector('#start')?.addEventListener('click',()=>{
      current?.cancel(false);
      current=startAuthPopup({url:'/auth/login'+window.location.search,next:'/app/courses/test',onPhase:phase=>{document.querySelector('#status').textContent=phase;document.querySelector('#start').disabled=phase==='waiting'||phase==='verifying';},onError:error=>{document.querySelector('#error').textContent=error;document.querySelector('#start').disabled=false;}});
    });
    document.querySelector('#cancel')?.addEventListener('click',()=>current?.cancel());
    document.querySelector('#complete')?.addEventListener('click',async()=>{await fetch('/test/session',{method:'POST'});completeAuthPopup(new URLSearchParams(location.search).get('attempt'),'success');});
    document.querySelector('#deny')?.addEventListener('click',()=>completeAuthPopup(new URLSearchParams(location.search).get('attempt'),'error'));
    document.querySelector('#stale')?.addEventListener('click',()=>completeAuthPopup(new URLSearchParams(location.search).get('attempt'),'success'));
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', alias: { '@': resolve(process.cwd(), 'src') } }).outputFiles[0].text;
  server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Cross-Origin-Opener-Policy', url.pathname === '/auth/login' && url.searchParams.get('sever') === '1' ? 'same-origin' : 'same-origin-allow-popups');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bundle); return; }
    if (url.pathname === '/test/session') { response.setHeader('Set-Cookie', 'popup_test_session=1; HttpOnly; SameSite=Lax; Path=/'); response.end('{}'); return; }
    if (url.pathname === '/api/v1/auth/session') { const valid = request.headers.cookie?.includes('popup_test_session=1'); response.statusCode = valid ? 200 : 401; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(valid ? { userId: 'verified-local-user' } : {})); return; }
    response.setHeader('Content-Type', 'text/html');
    const body = url.pathname === '/auth/login' ? '<button id="complete">Complete provider sign-in</button><button id="deny">Cancel provider sign-in</button>'
      : url.pathname === '/stale' ? '<button id="stale">Send old completion</button>'
        : url.pathname === '/welcome' ? '<h1>Server-verified navigation</h1>'
          : '<button id="start">Sign in</button><button id="cancel">Cancel</button><p id="status" role="status"></p><p id="error" role="alert"></p>';
    response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Popup contract</title></head><body>${body}<script src="/bundle.js"></script></body></html>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local test server');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(done => server.close(() => done())); });

test('keeps the parent in place until a real popup completes and the server confirms its session', async ({ page }) => {
  await page.goto(`${origin}/login`);
  const popupEvent = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); const popup = await popupEvent;
  await expect(page).toHaveURL(`${origin}/login`);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  await expect(popup.getByRole('button', { name: 'Complete provider sign-in' })).toBeVisible();
  await popup.getByRole('button', { name: 'Complete provider sign-in' }).click();
  await expect(page).toHaveURL(`${origin}/welcome?next=%2Fapp%2Fcourses%2Ftest`);
});

test('uses the matching channel when provider COOP removes window.opener', async ({ page }) => {
  await page.goto(`${origin}/login?sever=1`);
  const popupEvent = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); const popup = await popupEvent;
  await popup.waitForLoadState(); expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await expect(page).toHaveURL(`${origin}/login?sever=1`);
  await popup.getByRole('button', { name: 'Complete provider sign-in' }).click();
  await expect(page).toHaveURL(`${origin}/welcome?next=%2Fapp%2Fcourses%2Ftest`);
});

test('does not redirect when the browser blocks a popup', async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; }); await page.goto(`${origin}/login`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('alert')).toHaveText('blocked'); await expect(page).toHaveURL(`${origin}/login`);
});

test('ignores stale completion after retry even when a previous session already exists', async ({ page, context }) => {
  await context.addCookies([{ name: 'popup_test_session', value: '1', url: origin }]); await page.goto(`${origin}/login`);
  const firstEvent = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); const first = await firstEvent;
  await first.waitForLoadState();
  const oldAttempt = new URL(first.url()).searchParams.get('attempt');
  await first.close(); await expect(page.getByRole('status')).toHaveText('closed');
  const secondEvent = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); const second = await secondEvent;
  const stale = await context.newPage(); await stale.goto(`${origin}/stale?attempt=${oldAttempt}`); await stale.getByRole('button', { name: 'Send old completion' }).click();
  await expect(page).toHaveURL(`${origin}/login`); await expect(page.getByRole('status')).toHaveText('waiting');
  await second.getByRole('button', { name: 'Cancel provider sign-in' }).click();
  await expect(page.getByRole('alert')).toHaveText('provider'); await expect(page).toHaveURL(`${origin}/login`);
});
