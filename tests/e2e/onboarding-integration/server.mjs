// Runs the real Next app against an isolated local Auth/PostgREST fixture.
// This exercises SDK cookies, the callback and Server Actions, not Google's service.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const appOrigin = 'http://127.0.0.1:3191';
const apiOrigin = 'http://127.0.0.1:3192';
const id = '00000000-0000-4000-8000-000000000001';
let profile;
let writes;
let exchanges;
function reset() {
  profile = { id, handle: null, display_name: 'Google Learner', branch_id: null, locale: 'en', avatar_url: null, profile_public: false };
  writes = 0;
  exchanges = 0;
}
reset();
const user = { id, aud: 'authenticated', role: 'authenticated', email: 'google-learner@example.test', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: 'Google Learner' }, created_at: '2026-01-01T00:00:00Z' };
const jwt = () => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  'isolated-local-test-signature',
].join('.');
const fixture = createServer(async (req, res) => {
  const url = new URL(req.url, apiOrigin);
  res.setHeader('Access-Control-Allow-Origin', appOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-supabase-api-version');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/__test/reset') { reset(); return json({ ok: true }); }
  if (url.pathname === '/__test/state') return json({ profile, writes, exchanges });
  if (url.pathname === '/auth/v1/authorize') {
    if (url.searchParams.get('provider') !== 'google' || !url.searchParams.get('code_challenge')) return json({ error: 'Expected Google PKCE request' }, 400);
    const target = new URL(url.searchParams.get('redirect_to'));
    if (target.origin !== appOrigin) return json({ error: 'Unexpected callback origin' }, 400);
    target.searchParams.set('code', 'local-provider-code');
    res.writeHead(302, { Location: target.toString() }).end(); return;
  }
  if (url.pathname === '/auth/v1/token') {
    if (url.searchParams.get('grant_type') === 'pkce') {
      if (body.auth_code !== 'local-provider-code' || !body.code_verifier) return json({ error: 'PKCE verifier missing' }, 400);
      exchanges++;
    }
    return json({ access_token: jwt(), refresh_token: 'local-refresh', expires_in: 3600, token_type: 'bearer', user });
  }
  if (url.pathname === '/auth/v1/user') return json(user);
  if (url.pathname === '/rest/v1/profiles') {
    if (req.method === 'PATCH') {
      if (url.searchParams.get('id') !== `eq.${id}` || url.searchParams.get('handle') !== 'is.null') return json({ message: 'Unscoped profile mutation' }, 400);
      if (Object.keys(body).some(key => !['handle', 'display_name'].includes(key))) return json({ message: 'Unexpected mutation' }, 400);
      if (body.handle === 'taken_handle') return json({ code: '23505', message: 'Handle taken' }, 409);
      if (profile.handle !== null) return json([]);
      profile = { ...profile, ...body }; writes++;
    }
    return json(String(req.headers.accept).includes('application/vnd.pgrst.object+json') ? profile : [profile]);
  }
  if (url.pathname === '/rest/v1/user_accounts') return json([{ user_id: id, status: 'active' }]);
  if (url.pathname === '/rest/v1/rpc/authorization_actor') return json({ accountStatus: 'active', memberships: [], assignments: [] });
  if (url.pathname === '/rest/v1/rpc/xp_user_total') return json([{ total_points: 0, weekly_points: 0 }]);
  // A fresh learner has no enrollment, rewards or catalogue fixtures.
  if (url.pathname.startsWith('/rest/v1/') && (req.method === 'GET' || req.method === 'HEAD')) return json([]);
  return json({ message: `Unhandled local fixture route ${req.method} ${url.pathname}` }, 404);
});
await new Promise(resolve => fixture.listen(3192, '127.0.0.1', resolve));
const project = await mkdtemp(join(tmpdir(), 'vfuture-onboarding-next-'));
await symlink(join(root, 'node_modules'), join(project, 'node_modules'), 'dir');
async function file(path, contents) { await mkdir(join(project, path, '..'), { recursive: true }); await writeFile(join(project, path), contents); }
await file('package.json', JSON.stringify({ name: 'onboarding-integration', private: true }));
await file('tsconfig.json', JSON.stringify({ compilerOptions: { target:'ES2017', lib:['dom','esnext'], skipLibCheck:true, strict:true, noEmit:true, esModuleInterop:true, module:'esnext', moduleResolution:'bundler', resolveJsonModule:true, isolatedModules:true, jsx:'preserve', paths:{'@/*':[join(root,'src/*')]} }, include:['**/*.ts','**/*.tsx','.next/types/**/*.ts'],exclude:['node_modules'] }));
await file('next.config.mjs', `import createNextIntlPlugin from 'next-intl/plugin';\nexport default createNextIntlPlugin(${JSON.stringify(join(root, 'src/i18n/request.ts'))})({experimental:{authInterrupts:true,externalDir:true},allowedDevOrigins:['127.0.0.1'],webpack(config){config.resolve.alias['@']=${JSON.stringify(join(root, 'src'))};return config;}});`);
await file('app/layout.tsx', `import {NextIntlClientProvider} from 'next-intl';import {getLocale,getMessages} from 'next-intl/server';export default async function Layout({children}:{children:React.ReactNode}){const locale=await getLocale();return <html lang={locale}><body><NextIntlClientProvider locale={locale} messages={await getMessages()}>{children}</NextIntlClientProvider></body></html>}`);
for (const [target, source] of [
  ['app/login/page.tsx','app/(auth)/login/page'],
  ['app/welcome/page.tsx','app/(auth)/welcome/page'],
  ['app/app/page.tsx','app/app/page'],
  ['app/app/layout.tsx','app/app/layout'],
]) await file(target, `export const dynamic='force-dynamic';export {default} from '@/` + source + `';`);
await file('app/auth/callback/route.ts', `export {GET} from '@/app/auth/callback/route';`);
await file('middleware.ts', `export {middleware} from '@/middleware';export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};`);
const child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'dev', project, '--hostname', '127.0.0.1', '--port', '3191'], {
  cwd: root, stdio:'inherit', env:{...process.env, NEXT_PUBLIC_SUPABASE_URL:apiOrigin,NEXT_PUBLIC_SUPABASE_ANON_KEY:'local-anon-fixture',SUPABASE_SERVICE_ROLE_KEY:'local-service-fixture',NEXT_PUBLIC_APP_URL:appOrigin,AUTH_REDIRECT_ORIGINS:appOrigin,NEXT_PUBLIC_NOTEBOOK_RUNTIME_URL:'',NEXT_TELEMETRY_DISABLED:'1'},
});
let stopping = false;
async function stop() { if (stopping) return; stopping=true; child.kill('SIGTERM'); fixture.close(); await rm(project,{recursive:true,force:true}); }
process.on('SIGTERM',()=>void stop()); process.on('SIGINT',()=>void stop());
child.on('exit',async code=>{await stop();process.exitCode=code??0;});
