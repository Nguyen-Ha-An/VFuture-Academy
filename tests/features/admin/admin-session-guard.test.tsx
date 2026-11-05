// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import {afterEach,describe,it,expect,vi} from 'vitest';
import messages from '@/messages/en.json';
const mocks=vi.hoisted(()=>({listener:null as null|((event:string,session:{user:{id:string}}|null)=>void),replace:vi.fn(),refresh:vi.fn(),unsubscribe:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>mocks}));
vi.mock('@/lib/supabase/client',()=>({supabaseBrowser:()=>({auth:{onAuthStateChange:(listener:typeof mocks.listener)=>{mocks.listener=listener;return{data:{subscription:{unsubscribe:mocks.unsubscribe}}};}}})}));
import {AdminSessionGuard} from '@/features/admin/components/AdminSessionGuard';
afterEach(()=>{cleanup();vi.clearAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('Admin actor changes',()=>{
 it('removes old authorized children immediately when account changes',()=>{
  render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a"><p>Private member data</p></AdminSessionGuard></NextIntlClientProvider>);
  act(()=>mocks.listener?.('SIGNED_IN',{user:{id:'a'}}));expect(screen.getByText('Private member data')).toBeInTheDocument();
  act(()=>mocks.listener?.('SIGNED_IN',{user:{id:'b'}}));expect(screen.queryByText('Private member data')).not.toBeInTheDocument();expect(mocks.replace).toHaveBeenCalledWith('/admin');expect(screen.getByRole('status')).toBeInTheDocument();
 });
 it('returns a Studio actor change to the Studio landing page',()=>{
  render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a" destination="/studio"><p>Studio content</p></AdminSessionGuard></NextIntlClientProvider>);
  act(()=>mocks.listener?.('SIGNED_IN',{user:{id:'b'}}));expect(mocks.replace).toHaveBeenCalledWith('/studio');
 });
});

it('checks Azure server sessions and conceals an actor change without using Supabase events', async()=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({userId:'b'}),{status:200})));
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a"><p>Azure private data</p></AdminSessionGuard></NextIntlClientProvider>);});
 expect(screen.queryByText('Azure private data')).not.toBeInTheDocument();
 expect(mocks.replace).toHaveBeenCalledWith('/admin');
});

it.each(['network', 'server'])('restores the same actor after a temporary Azure %s failure', async(failure)=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 const fetchSession=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({userId:'a'}),{status:200})));
 if(failure==='network')fetchSession.mockRejectedValueOnce(new Error('offline'));
 else fetchSession.mockResolvedValueOnce(new Response('{}',{status:503}));
 vi.stubGlobal('fetch',fetchSession);
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a"><p>Private member data</p></AdminSessionGuard></NextIntlClientProvider>);});
 expect(screen.queryByText('Private member data')).not.toBeInTheDocument();
 await act(async()=>{window.dispatchEvent(new Event('focus'));});
 expect(screen.getByText('Private member data')).toBeInTheDocument();
});

it('does not restore stale staff content after a confirmed account change', async()=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 const fetchSession=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({userId:'b'}),{status:200})).mockResolvedValue(new Response(JSON.stringify({userId:'a'}),{status:200}));
 vi.stubGlobal('fetch',fetchSession);
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a"><p>Private member data</p></AdminSessionGuard></NextIntlClientProvider>);});
 await act(async()=>{window.dispatchEvent(new Event('focus'));});
 expect(screen.queryByText('Private member data')).not.toBeInTheDocument();
 expect(mocks.replace).toHaveBeenCalledWith('/admin');
});
