import {beforeEach,describe,it,expect,vi} from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
const mocks=vi.hoisted(()=>({context:vi.fn(),read:vi.fn(),actors:vi.fn(),notFound:vi.fn(()=>{throw new Error('not-found');}),locale:'en'}));
vi.mock('server-only',()=>({}));
vi.mock('@/features/admin/context',()=>({adminPageContext:mocks.context}));
vi.mock('@/features/admin/management',()=>({managementRead:mocks.read}));
vi.mock('@/features/admin/actor-directory',()=>({actorDisplayNames:mocks.actors}));
vi.mock('next-intl/server',()=>({getTranslations:async()=> (key:string,values?:Record<string,unknown>)=>values?`${key}:${Object.values(values).join(',')}`:key,getLocale:async()=>mocks.locale}));
vi.mock('next/navigation',()=>({notFound:mocks.notFound,usePathname:()=>'/admin/audit',useSearchParams:()=>new URLSearchParams(),useRouter:()=>({replace:vi.fn()})}));
import AuditPage from '@/app/admin/audit/page';
import { familyFilterValue } from '@/app/admin/audit/data';
const ACTOR='00000000-0000-4000-8000-000000000101';
function html(page:ReactElement){return renderToStaticMarkup(<NextIntlClientProvider locale="en" messages={staffUiTestMessages(en,'en')}>{page}</NextIntlClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();mocks.locale='en';mocks.context.mockResolvedValue({scope:{kind:'branch',branchId:'ans'}});mocks.read.mockResolvedValue([]);mocks.actors.mockResolvedValue(new Map());});
describe('audit page scope and filters',()=>{
 it('asks for audit access and keeps current school context',async()=>{const page=await AuditPage();expect(page).toBeDefined();expect(mocks.context).toHaveBeenCalledWith('audit.read');expect(mocks.read).toHaveBeenCalledWith({scope:{kind:'branch',branchId:'ans'}},'audit',{page:1});});
 it('does not load audit records when the page guard denies access',async()=>{mocks.context.mockRejectedValue(new Error('forbidden'));await expect(AuditPage()).rejects.toThrow('forbidden');expect(mocks.read).not.toHaveBeenCalled();expect(mocks.actors).not.toHaveBeenCalled();});
 it('rejects malformed filters and forwards valid ones',async()=>{await expect(AuditPage({searchParams:Promise.resolve({actor:'invalid'})})).rejects.toThrow('not-found');expect(mocks.read).not.toHaveBeenCalled();await AuditPage({searchParams:Promise.resolve({action:'user.role',page:'2'})});expect(mocks.read).toHaveBeenLastCalledWith(expect.anything(),'audit',{action:'user.role',page:2});});
 it('renders known action labels and keeps unknown action codes as secondary detail',async()=>{
  mocks.read.mockResolvedValue([
   {id:'1',action:'user.role',actorId:ACTOR,targetType:'user',targetId:'member-1',at:'2026-09-06T00:00:00.000Z'},
   {id:'2',action:'future.workflow.done',actorId:null,targetType:'workflow',targetId:'job-1',at:'2026-09-06T00:00:00.000Z'},
  ]);
  const markup=html(await AuditPage());
  expect(markup).toContain('Role assignment changed');
  expect(markup).toContain('Future workflow done');
  expect(markup).toContain('future.workflow.done');
 expect(markup.indexOf('Future workflow done')).toBeLessThan(markup.indexOf('future.workflow.done'));
 });
 it('passes the server locale to audit action and target formatting',async()=>{
  mocks.locale='vi';
  mocks.read.mockResolvedValue([{id:'1',action:'user.account-status',actorId:ACTOR,targetType:'user',targetId:'member-1',at:'2026-09-06T00:00:00.000Z'}]);
  const markup=html(await AuditPage());
  expect(markup).toContain('Đã thay đổi trạng thái tài khoản');
  expect(markup).toContain('Thành viên');
 });
 it('shows actor names from the directory linking to their own history, and System when no actor is recorded',async()=>{
  mocks.read.mockResolvedValue([
   {id:'1',action:'user.role',actorId:ACTOR,targetType:'user',targetId:'member-1',at:'2026-09-06T00:00:00.000Z'},
   {id:'2',action:'branch.create',actorId:null,targetType:'branch',targetId:'ans',at:'2026-09-06T00:00:00.000Z'},
  ]);
  mocks.actors.mockResolvedValue(new Map([[ACTOR,{name:'Nguyễn Minh Anh',avatarUrl:null,initials:'MA'}]]));
  const markup=html(await AuditPage({searchParams:Promise.resolve({action:'user.'})}));
  expect(mocks.actors).toHaveBeenCalledWith([ACTOR,null,undefined]);
  expect(markup).toContain('Nguyễn Minh Anh');
  expect(markup).toContain(`href="/admin/audit?actor=${ACTOR}&amp;action=user."`);
  expect(markup).toContain('>system<');
  expect(markup).not.toContain(`>${ACTOR}<`);
 });
 it('falls back to the actor id when the directory has no name',async()=>{
  mocks.read.mockResolvedValue([{id:'1',action:'user.role',actorId:ACTOR,targetType:'user',targetId:'member-1',at:'2026-09-06T00:00:00.000Z'}]);
  const markup=html(await AuditPage());
  expect(markup).toContain(`>${ACTOR}<`);
 });
 it('offers an action-family select that keeps the current filter and an empty state when nothing matches',async()=>{
  const markup=html(await AuditPage({searchParams:Promise.resolve({action:'role'})}));
  expect(markup).toMatch(/<select[^>]*name="action"[^>]*aria-label="familyLabel"/);
  expect(markup).toMatch(/<option[^>]*value="role"[^>]*selected=""[^>]*>families\.role<\/option>/);
  expect(markup).toContain('emptyTitle');
  expect(markup).toContain('href="/admin/audit"');
  const legacy=html(await AuditPage({searchParams:Promise.resolve({action:'user.role'})}));
  expect(legacy).toMatch(/<option[^>]*value="user\.role"[^>]*selected=""[^>]*>user\.role<\/option>/);
 });
 it('pages with "Page n" and only links to the next page when a full page came back',async()=>{
  const row=(id:number)=>({id:String(id),action:'user.role',actorId:null,targetType:'user',targetId:`m-${id}`,at:'2026-09-06T00:00:00.000Z'});
  mocks.read.mockResolvedValue(Array.from({length:50},(_,index)=>row(index)));
  const full=html(await AuditPage({searchParams:Promise.resolve({page:'2'})}));
  expect(full).toContain('Page 2');
  expect(full).toContain('href="/admin/audit?page=3"');
  expect(full).toContain('href="/admin/audit"');
  mocks.read.mockResolvedValue([row(1)]);
  const last=html(await AuditPage());
  expect(last).toContain('Page 1');
  expect(last).not.toContain('page=2');
 });
 it('matches every role code, assignments included, with the Roles family',()=>{
  // The audit operation filters by substring, so the family value must be inside each code.
  for(const code of ['role.create','role.update','user.role','user.role.set','user.role_granted','user.role_revoked'])
   expect(code.includes(familyFilterValue('role'))).toBe(true);
  expect(familyFilterValue('user')).toBe('user.');
 });
 it('names member and school targets instead of showing their ids',async()=>{
  mocks.context.mockResolvedValue({scope:{kind:'branch',branchId:'ans'},branches:[{id:'ans',name:'Amsterdam'}]});
  mocks.read.mockResolvedValue([
   {id:'1',action:'user.role_granted',actorId:null,targetType:'user',targetId:'member-1',at:'2026-09-06T00:00:00.000Z'},
   {id:'2',action:'branch.update',actorId:null,targetType:'branch',targetId:'ans',at:'2026-09-06T00:00:00.000Z'},
  ]);
  mocks.actors.mockImplementation(async(ids:Iterable<string>)=>new Map([...ids].includes('member-1')?[['member-1',{name:'Lê Thu Hà',avatarUrl:null,initials:'TH'}]]:[]));
  const markup=html(await AuditPage());
  expect(markup).toContain('Lê Thu Hà');
  expect(markup).toContain('Amsterdam');
  expect(markup).not.toContain('font-mono');
 });
});
