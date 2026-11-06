import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({jar:new Map<string,string>(),oauth:vi.fn(),exchange:vi.fn(),getUser:vi.fn(),rate:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({cookies:async()=>({get:(name:string)=>mocks.jar.has(name)?{value:mocks.jar.get(name)}:undefined,set:(name:string,value:string)=>{mocks.jar.set(name,value);}})}));
vi.mock('@/lib/env',()=>({env:{NEXT_PUBLIC_APP_URL:'https://academy.example',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'local-test-signing-secret'}}));
vi.mock('@/lib/rate-limit',()=>({enforceRequestRateLimit:mocks.rate}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:()=>({}),supabaseUser:async()=>({auth:{signInWithOAuth:mocks.oauth,exchangeCodeForSession:mocks.exchange,getUser:mocks.getUser},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{handle:'STU-learner',display_name:'Learner'},error:null})})})})})}));
import { consumeLegacyPopup, legacyPopupLogin } from '@/lib/identity/legacy-popup';
import { GET as callback } from '@/app/auth/callback/route';
const attempt='a'.repeat(48);
async function start(popupAttempt=attempt){await legacyPopupLogin(new Request(`https://academy.example/auth/login?provider=google&popup=1&attempt=${popupAttempt}&next=%2Fapp`));return new URL(mocks.oauth.mock.calls.at(-1)![0].options.redirectTo);}
describe('legacy Supabase popup flow',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.jar.clear();vi.stubEnv('ACADEMY_BACKEND','supabase');vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','supabase');mocks.oauth.mockResolvedValue({data:{url:'https://example.supabase.co/auth/v1/authorize?provider=google'},error:null});mocks.exchange.mockResolvedValue({error:null});mocks.getUser.mockResolvedValue({data:{user:{id:'verified-user'}},error:null});});
 afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
 it('uses server cookie-bound PKCE with signed popup context consumed once',async()=>{
  const destination=await start();expect(mocks.oauth.mock.calls[0][0].options.skipBrowserRedirect).toBe(true);
  expect(await consumeLegacyPopup(new Request(destination))).toBe(attempt);
  await expect(consumeLegacyPopup(new Request(destination))).rejects.toThrow('Invalid popup context');
 });
 it('rejects tampered display context before any authentication exchange',async()=>{
  const destination=await start();const [name,value]=[...mocks.jar][0];mocks.jar.set(name,'tampered.'+value.split('.')[1]);destination.searchParams.set('code','untrusted');
  const response=await callback(new Request(destination));expect(response.headers.get('location')).toContain('/login?error=provider');expect(mocks.exchange).not.toHaveBeenCalled();
 });
 it('signals completion without passing a code or user to the parent URL',async()=>{
  const destination=await start();destination.searchParams.set('code','private-code');
  const response=await callback(new Request(destination));const target=new URL(response.headers.get('location')!);
  expect(target.pathname).toBe('/auth/popup');expect(target.searchParams.get('attempt')).toBe(attempt);expect(target.searchParams.get('status')).toBe('success');expect(target.searchParams.size).toBe(2);expect(target.href).not.toContain('private-code');
 });
 it('rejects expired popup context',async()=>{
  vi.useFakeTimers();const destination=await start();vi.advanceTimersByTime(600001);
  await expect(consumeLegacyPopup(new Request(destination))).rejects.toThrow('Invalid popup context');
 });
 it('does not erase a newer signed context when an old or bogus callback arrives',async()=>{
  const oldDestination=await start();const currentDestination=await start('b'.repeat(48));
  const sharedEntry=[...mocks.jar].find(([name])=>name.endsWith('academy_popup_legacy'))!;
  await expect(consumeLegacyPopup(new Request(oldDestination))).rejects.toThrow('Invalid popup context');
  expect(mocks.jar.get(sharedEntry[0])).toBe(sharedEntry[1]);
  const bogus=new URL(currentDestination);bogus.searchParams.set('popup_state','x'.repeat(43));
  await expect(consumeLegacyPopup(new Request(bogus))).rejects.toThrow('Invalid popup context');
  expect(mocks.jar.get(sharedEntry[0])).toBe(sharedEntry[1]);
  expect(await consumeLegacyPopup(new Request(currentDestination))).toBe('b'.repeat(48));
  expect(mocks.jar.get(sharedEntry[0])).toBe(sharedEntry[1]);
  await expect(consumeLegacyPopup(new Request(currentDestination))).rejects.toThrow('Invalid popup context');
 });

});
