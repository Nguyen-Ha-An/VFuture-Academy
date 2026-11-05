// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StaffWorkspaceShell } from '@/features/staff-ui/ui/StaffWorkspaceShell';
import { useUnsavedChanges } from '@/features/studio/ui/useUnsavedChanges';
import { registerNavigationGuard } from '@/lib/navigation-guard';
import { staffUiTestMessages } from '@/messages/staff-ui';
import en from '@/messages/en.json';
const nav=vi.hoisted(()=>({pathname:'/studio/courses/fixture',push:vi.fn(),replace:vi.fn(),refresh:vi.fn()}));
vi.mock('next/navigation',async original=>({...await original<typeof import('next/navigation')>(),usePathname:()=>nav.pathname,useRouter:()=>nav,useSearchParams:()=>new URLSearchParams()}));
vi.mock('@/features/staff-ui/ui/StaffCommandMenu',()=>({StaffCommandMenu:()=>null}));
vi.mock('@/features/staff-ui/ui/AttentionPopover',()=>({AttentionPopover:()=>null}));
function Editor(){const {dialog}=useUnsavedChanges(true,async()=>false);return <><h1 tabIndex={-1}>Dirty editor</h1><input aria-label="Draft" defaultValue="Retained draft" />{dialog}</>;}
function View(){return <NextIntlClientProvider locale="en" messages={staffUiTestMessages(en,'en')}><StaffWorkspaceShell workspace="studio" chrome={{theme:'light',sidebarOpen:true,identity:{name:'Synthetic author',email:'author@example.test',avatarUrl:null,initials:'SA'}}} permissions={['course.read']} entries={{studio:'/studio',grading:'/grading',admin:'/admin'}}><Editor /></StaffWorkspaceShell></NextIntlClientProvider>;}
beforeEach(()=>{window.innerWidth=390;window.history.replaceState(null,'','/studio/courses/fixture');nav.pathname='/studio/courses/fixture';nav.push.mockReset();vi.stubGlobal('matchMedia',(query:string)=>({matches:query.includes('max-width'),addEventListener:vi.fn(),removeEventListener:vi.fn()}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function open(){fireEvent.click(screen.getByRole('button',{name:en.common.menu}));return screen.findByRole('dialog',{name:en.common.studioNavigation});}
it.each([['contextual','/studio/courses'],['global','/app/courses']])('releases mobile %s navigation before the real dirty guard; Stay preserves and Discard navigates once',async(_kind,href)=>{
 render(<View />);let drawer=await open();const link=drawer.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);expect(link).not.toBeNull();fireEvent.click(link!);
 let guard=await screen.findByRole('dialog',{name:en.studioWorkspace.leaveTitle});expect(document.querySelectorAll('.canvas-staff-overlay-mount [role="dialog"]')).toHaveLength(0);expect(screen.getAllByRole('dialog')).toHaveLength(1);
 fireEvent.click(within(guard).getByRole('button',{name:en.studioWorkspace.stay}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(nav.push).not.toHaveBeenCalled();expect(screen.getByRole('textbox',{name:'Draft'})).toHaveValue('Retained draft');
 drawer=await open();fireEvent.click(drawer.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!);guard=await screen.findByRole('dialog',{name:en.studioWorkspace.leaveTitle});fireEvent.click(within(guard).getByRole('button',{name:en.studioWorkspace.discard}));await waitFor(()=>expect(nav.push).toHaveBeenCalledExactlyOnceWith(href));
});
it('keeps modified clicks native and rejects an approval after another navigation drawer session opens',async()=>{
 render(<View />);let drawer=await open();const link=drawer.querySelector<HTMLAnchorElement>('a[href="/studio/courses"]')!;expect(fireEvent.click(link,{metaKey:true,button:0})).toBe(true);expect(screen.queryByRole('dialog',{name:en.studioWorkspace.leaveTitle})).toBeNull();expect(nav.push).not.toHaveBeenCalled();
 let release!:(allowed:boolean)=>void;const pending=new Promise<boolean>(resolve=>{release=resolve;});const check=vi.fn(()=>pending);const unregister=registerNavigationGuard(check);
 try{fireEvent.click(link);const guard=await screen.findByRole('dialog',{name:en.studioWorkspace.leaveTitle});fireEvent.click(within(guard).getByRole('button',{name:en.studioWorkspace.discard}));await waitFor(()=>expect(check).toHaveBeenCalledOnce());drawer=await open();expect(drawer).toBeVisible();await act(async()=>{release(true);await pending;});expect(nav.push).not.toHaveBeenCalled();expect(screen.getByRole('textbox',{name:'Draft',hidden:true})).toHaveValue('Retained draft');}finally{unregister();}
});
it('cancels an exiting drawer action on rapid reopen and accepts the next explicit choice',async()=>{
 render(<View />);let drawer=await open();fireEvent.click(drawer.querySelector<HTMLAnchorElement>('a[href="/studio/courses"]')!);
 // Reopen while the native exit transition still owns its queued action.
 fireEvent.click(screen.getByRole('button',{name:en.common.menu,hidden:true}));
 drawer=await screen.findByRole('dialog',{name:en.common.studioNavigation});
 fireEvent.click(drawer.querySelector<HTMLAnchorElement>('a[href="/studio/courses"]')!);
 const guard=await screen.findByRole('dialog',{name:en.studioWorkspace.leaveTitle});
 expect(document.querySelectorAll('.canvas-staff-overlay-mount [role="dialog"]')).toHaveLength(0);
 fireEvent.click(within(guard).getByRole('button',{name:en.studioWorkspace.stay}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(nav.push).not.toHaveBeenCalled();
});
