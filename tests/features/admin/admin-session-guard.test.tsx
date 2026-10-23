// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {NextIntlClientProvider} from 'next-intl';
import {afterEach,describe,it,expect,vi} from 'vitest';
import messages from '@/messages/en.json';
const mocks=vi.hoisted(()=>({listener:null as null|((event:string,session:{user:{id:string}}|null)=>void),replace:vi.fn(),refresh:vi.fn(),unsubscribe:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:mocks.replace,refresh:mocks.refresh})}));
vi.mock('@/lib/supabase/client',()=>({supabaseBrowser:()=>({auth:{onAuthStateChange:(listener:typeof mocks.listener)=>{mocks.listener=listener;return{data:{subscription:{unsubscribe:mocks.unsubscribe}}};}}})}));
import {AdminSessionGuard} from '@/features/admin/components/AdminSessionGuard';
afterEach(()=>{cleanup();vi.clearAllMocks();});
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
