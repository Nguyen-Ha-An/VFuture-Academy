// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useState} from 'react';
import {createPortal} from 'react-dom';
import {NextIntlClientProvider} from 'next-intl';
import {afterEach,describe,it,expect,vi} from 'vitest';
import messages from '@/messages/en.json';
const mocks=vi.hoisted(()=>({listener:null as null|((event:string,session:{user:{id:string}}|null)=>void),replace:vi.fn(),refresh:vi.fn(),unsubscribe:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>mocks}));
vi.mock('@/lib/supabase/client',()=>({supabaseBrowser:()=>({auth:{onAuthStateChange:(listener:typeof mocks.listener)=>{mocks.listener=listener;return{data:{subscription:{unsubscribe:mocks.unsubscribe}}};}}})}));
import {AdminSessionGuard} from '@/features/admin/components/AdminSessionGuard';
import {notifyIdentityChanged} from '@/lib/identity/browser-session';
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

it.each(['network', 'server', 'timeout'])('restores the same actor after a temporary Azure %s failure', async(failure)=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 const fetchSession=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({userId:'a'}),{status:200})));
 if(failure==='network'||failure==='timeout')fetchSession.mockRejectedValueOnce(new DOMException(failure, failure==='timeout'?'TimeoutError':'NetworkError'));
 else fetchSession.mockResolvedValueOnce(new Response('{}',{status:503}));
 vi.stubGlobal('fetch',fetchSession);
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a"><p>Private member data</p></AdminSessionGuard></NextIntlClientProvider>);});
 expect(screen.getByText('Private member data')).not.toBeVisible();
 expect(mocks.refresh).not.toHaveBeenCalled();expect(mocks.replace).not.toHaveBeenCalled();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Try again'}));});
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

it('coalesces returning-tab checks and conceals old data until the server validates the actor', async()=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 let finish!:(response:Response)=>void;
 const fetchSession=vi.fn().mockResolvedValueOnce(Response.json({userId:'a'})).mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve;}));
 vi.stubGlobal('fetch',fetchSession);
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a"><p>Private member data</p></AdminSessionGuard></NextIntlClientProvider>);});
 expect(screen.getByText('Private member data')).toBeInTheDocument();
 act(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('focus'));});
 expect(fetchSession).toHaveBeenCalledTimes(2);
 expect(screen.getByText('Private member data')).not.toBeVisible();
 await act(async()=>{finish(Response.json({userId:'a'}));});
 expect(screen.getByText('Private member data')).toBeInTheDocument();
});

it('reauthenticates a revoked or expired session with the safe current return URL', async()=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 window.history.replaceState({},'', '/studio/bank?query=lesson');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a" destination="/studio"><p>Private member data</p></AdminSessionGuard></NextIntlClientProvider>);});
 expect(screen.queryByText('Private member data')).not.toBeInTheDocument();
 expect(mocks.replace).toHaveBeenCalledWith('/login?next=%2Fstudio%2Fbank%3Fquery%3Dlesson');
 window.history.replaceState({},'', '/');
});

it('conceals an explicit cross-tab logout while an older session check is in flight', async()=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 let finish!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn().mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve;})));
 act(()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a"><p>Private member data</p></AdminSessionGuard></NextIntlClientProvider>);});
 act(()=>{window.dispatchEvent(new StorageEvent('storage',{key:'vfuture:auth:signed-out',newValue:'123'}));});
 expect(screen.queryByText('Private member data')).not.toBeInTheDocument();
 await act(async()=>{finish(Response.json({userId:'a'}));});
 expect(screen.queryByText('Private member data')).not.toBeInTheDocument();
});

it('invalidates an older actor check when a confirmed login broadcasts an identity change', async()=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 const finishes:Array<(response:Response)=>void>=[];
 const fetchSession=vi.fn().mockResolvedValueOnce(Response.json({userId:'a'})).mockImplementation(()=>new Promise<Response>(resolve=>{finishes.push(resolve);}));
 vi.stubGlobal('fetch',fetchSession);
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a"><p>Private member data</p></AdminSessionGuard></NextIntlClientProvider>);});
 act(()=>{window.dispatchEvent(new Event('focus'));notifyIdentityChanged();});
 expect(screen.getByText('Private member data')).not.toBeVisible();
 await act(async()=>{finishes[0](Response.json({userId:'a'}));});
 expect(screen.getByText('Private member data')).not.toBeVisible();
 expect(fetchSession).toHaveBeenCalledTimes(3);
 await act(async()=>{finishes[1](Response.json({userId:'b'}));});
 expect(screen.queryByText('Private member data')).not.toBeInTheDocument();
 expect(mocks.replace).toHaveBeenCalledWith('/admin');
});

it('preserves an unsaved workspace draft while a returning-tab check temporarily conceals it', async()=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 const fetchSession=vi.fn().mockImplementation(async()=>Response.json({userId:'a'}));
 vi.stubGlobal('fetch',fetchSession);
 function Draft(){const [text,setText]=useState('');return <input aria-label="Draft" value={text} onChange={event=>setText(event.target.value)}/>;}
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a"><Draft/></AdminSessionGuard></NextIntlClientProvider>);});
 fireEvent.change(screen.getByRole('textbox',{name:'Draft'}),{target:{value:'Unsaved lesson'}});
 await act(async()=>{window.dispatchEvent(new Event('focus'));});
 expect(screen.getByRole('textbox',{name:'Draft'})).toHaveValue('Unsaved lesson');
});

it('fences a request started before backgrounding and validates a fresh returning-tab actor', async()=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 const finishes:Array<(response:Response)=>void>=[];
 const fetchSession=vi.fn().mockResolvedValueOnce(Response.json({userId:'a'})).mockImplementation(()=>new Promise<Response>(resolve=>finishes.push(resolve)));
 vi.stubGlobal('fetch',fetchSession);
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a"><p>Private member data</p></AdminSessionGuard></NextIntlClientProvider>);});
 act(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('focus'));});
 expect(screen.getByText('Private member data')).not.toBeVisible();
 await act(async()=>{finishes[0](Response.json({userId:'a'}));});
 expect(screen.getByText('Private member data')).not.toBeVisible();
 expect(fetchSession).toHaveBeenCalledTimes(3);
 await act(async()=>{finishes[1](Response.json({userId:'b'}));});
 expect(screen.queryByText('Private member data')).not.toBeInTheDocument();
 expect(mocks.replace).toHaveBeenCalledWith('/admin');
});

it('conceals privileged body portals during an outage and preserves the same actor draft for retry', async()=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 const fetchSession=vi.fn().mockResolvedValueOnce(Response.json({userId:'a'})).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Response.json({userId:'a'}));
 vi.stubGlobal('fetch',fetchSession);
 function DraftPortal(){const [text,setText]=useState('');return createPortal(<aside><p>Privileged portal</p><input aria-label="Portal draft" value={text} onChange={event=>setText(event.target.value)}/></aside>,document.body);}
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="a"><DraftPortal/></AdminSessionGuard></NextIntlClientProvider>);});
 const portalEditor=screen.getByRole('textbox',{name:'Portal draft'}) as HTMLInputElement;
 fireEvent.change(portalEditor,{target:{value:'Unsaved portal lesson'}});portalEditor.focus();portalEditor.setSelectionRange(2,7);
 await act(async()=>{window.dispatchEvent(new Event('focus'));});
 expect(screen.getByText('Privileged portal')).not.toBeVisible();
 expect(screen.getByText('Privileged portal').closest('aside')).toHaveAttribute('inert');
 expect(screen.getByRole('button',{name:'Try again'})).toBeVisible();
 screen.getByRole('button',{name:'Try again'}).focus();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Try again'}));});
 expect(screen.getByText('Privileged portal')).toBeVisible();
 expect(screen.getByRole('textbox',{name:'Portal draft'})).toHaveValue('Unsaved portal lesson');
 expect(portalEditor).toHaveFocus();expect(portalEditor.selectionStart).toBe(2);expect(portalEditor.selectionEnd).toBe(7);
});

it.each(['changed', 'expired'] as const)('conceals a learner session that is %s and navigates within learner context', async outcome=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 window.history.replaceState({},'', '/app/courses/one/items/lesson?panel=answers#draft');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({userId:'learner-a'})).mockResolvedValue(outcome==='expired'?new Response('{}',{status:401}):Response.json({userId:'learner-b'})));
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="learner-a" destination="/app"><p>Original learner answers</p></AdminSessionGuard></NextIntlClientProvider>);});
 await act(async()=>{window.dispatchEvent(new StorageEvent('storage',{key:'vfuture:auth:changed',newValue:'new-login'}));});
 expect(screen.queryByText('Original learner answers')).not.toBeInTheDocument();
 expect(mocks.replace).toHaveBeenCalledWith(outcome==='expired'?'/login?next=%2Fapp%2Fcourses%2Fone%2Fitems%2Flesson%3Fpanel%3Danswers%23draft':'/app');
 window.history.replaceState({},'', '/');
});

it('restores the learner editor focus and cursor after same-actor network recovery without remounting', async()=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 const fetchSession=vi.fn().mockResolvedValueOnce(Response.json({userId:'learner-a'})).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Response.json({userId:'learner-a'}));
 vi.stubGlobal('fetch',fetchSession);
 function Draft(){const [text,setText]=useState('');return <input aria-label="Learner answer" value={text} onChange={event=>setText(event.target.value)}/>;}
 await act(async()=>{render(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="learner-a" destination="/app"><Draft/></AdminSessionGuard></NextIntlClientProvider>);});
 const editor=screen.getByRole('textbox',{name:'Learner answer'}) as HTMLInputElement;
 fireEvent.change(editor,{target:{value:'Unsaved learner answer'}});editor.focus();editor.setSelectionRange(3,8,'backward');
 await act(async()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});
 expect(editor).not.toBeVisible();
 const retry=screen.getByRole('button',{name:'Try again'});retry.focus();
 expect(mocks.refresh).not.toHaveBeenCalled();expect(mocks.replace).not.toHaveBeenCalled();
 await act(async()=>{fireEvent.click(retry);});
 expect(screen.getByRole('textbox',{name:'Learner answer'})).toBe(editor);
 expect(editor).toHaveValue('Unsaved learner answer');
 expect(editor).toHaveFocus();
 expect(editor.selectionStart).toBe(3);expect(editor.selectionEnd).toBe(8);expect(editor.selectionDirection).toBe('backward');
});

it('leaves direct-body learner content interactive after initial validation and retry', async()=>{
 vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({userId:'learner-a'})).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Response.json({userId:'learner-a'})));
 function Learner(){const [count,setCount]=useState(0);return <main><input aria-label="Direct learner draft" defaultValue="Unsaved answer"/><button onClick={()=>setCount(value=>value+1)}>Learner action {count}</button></main>;}
 await act(async()=>{render(createPortal(<NextIntlClientProvider locale="en" messages={messages}><AdminSessionGuard actorId="learner-a" destination="/app"><Learner/></AdminSessionGuard></NextIntlClientProvider>,document.body));});
 const first=screen.getByText('Learner action 0');
 expect(first.closest('[inert]')).toBeNull();expect(first.closest('[hidden]')).toBeNull();
 fireEvent.click(first);expect(screen.getByRole('button',{name:'Learner action 1'})).toBeVisible();
 const editor=screen.getByRole('textbox',{name:'Direct learner draft'}) as HTMLInputElement;editor.focus();editor.setSelectionRange(2,6);
 await act(async()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});
 expect(editor).not.toBeVisible();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Try again'}));});
 expect(screen.getByRole('textbox',{name:'Direct learner draft'})).toBe(editor);expect(editor).toHaveFocus();
 expect(editor.closest('[inert]')).toBeNull();expect(editor.closest('[hidden]')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Learner action 1'}));expect(screen.getByRole('button',{name:'Learner action 2'})).toBeVisible();
});
