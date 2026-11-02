// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({navigate:vi.fn()}));
vi.mock('@/lib/post-auth-navigation',()=>({navigateAfterAuth:mocks.navigate}));
import { startAuthPopup } from '@/lib/identity/popup-client';
let channels: FakeChannel[]=[];
class FakeChannel { onmessage:((event:MessageEvent)=>void)|null=null; name:string; postMessage=vi.fn(); close=vi.fn(); constructor(name:string){this.name=name;channels.push(this);} }
const popup={closed:false,close:vi.fn(),focus:vi.fn()};
function signal(attempt:string,source:unknown=popup,origin=window.location.origin,status='success'){
 const event=new MessageEvent('message',{origin,data:{type:'academy-auth-popup',attempt,status}});Object.defineProperty(event,'source',{value:source});window.dispatchEvent(event);
}
describe('popup completion authentication boundary',()=>{
 beforeEach(()=>{vi.clearAllMocks();channels=[];popup.closed=false;vi.stubGlobal('BroadcastChannel',FakeChannel);vi.spyOn(window,'open').mockReturnValue(popup as unknown as Window);vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({userId:'verified-user'}))));});
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
 it('reports blocked popups without navigating the parent',()=>{
  vi.mocked(window.open).mockReturnValue(null);const error=vi.fn();startAuthPopup({url:'/auth/login?provider=google',next:'/app',onPhase:vi.fn(),onError:error});
  expect(error).toHaveBeenCalledWith('blocked');expect(mocks.navigate).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it('requires exact origin, source, attempt and then a server-verified session',async()=>{
  const handle=startAuthPopup({url:'/auth/login?provider=google',next:'https://evil.example',onPhase:vi.fn(),onError:vi.fn()});
  const attempt=new URL(String(vi.mocked(window.open).mock.calls[0][0])).searchParams.get('attempt')!;
  expect(attempt).toMatch(/^[a-f0-9]{48}$/);
  signal(attempt,{},window.location.origin);signal(attempt,popup,'https://evil.example');signal('0'.repeat(48));expect(fetch).not.toHaveBeenCalled();
  signal(attempt);await vi.waitFor(()=>expect(mocks.navigate).toHaveBeenCalledWith('/welcome?next=%2Fapp'));
  expect(fetch).toHaveBeenCalledWith('/api/v1/auth/session',expect.objectContaining({credentials:'same-origin',cache:'no-store'}));handle.cancel();
 });
 it('accepts an attempt-bound channel after COOP severs opener, but still denies an absent session',async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response('{}',{status:401}));const error=vi.fn();const handle=startAuthPopup({url:'/auth/login?provider=microsoft',next:'/studio',onPhase:vi.fn(),onError:error});
  const attempt=channels[0].name.replace('academy-auth-popup:','');
  channels[0].onmessage?.(new MessageEvent('message',{origin:window.location.origin,data:{type:'academy-auth-popup',attempt,status:'success'}}));
  await vi.waitFor(()=>expect(error).toHaveBeenCalledWith('session'));expect(mocks.navigate).not.toHaveBeenCalled();handle.cancel();
 });
 it('continues listening after a severed window looks closed and ignores cancelled attempts',()=>{
  vi.useFakeTimers();const phase=vi.fn();const handle=startAuthPopup({url:'/auth/login?provider=google',next:'/app',onPhase:phase,onError:vi.fn()});
  popup.closed=true;vi.advanceTimersByTime(1200);expect(phase).toHaveBeenCalledWith('closed');expect(channels[0].close).not.toHaveBeenCalled();
  const attempt=channels[0].name.replace('academy-auth-popup:','');handle.cancel();signal(attempt);expect(fetch).not.toHaveBeenCalled();
 });
});
