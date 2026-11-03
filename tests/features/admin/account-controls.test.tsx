// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {NextIntlClientProvider} from 'next-intl';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {AccountControls} from '@/features/admin/components/AccountControls';
const userId='11111111-1111-4111-8111-111111111111';
const state={userId,status:'active',operation:null};
const data=(value:unknown,status=200)=>new Response(JSON.stringify({data:value}),{status});
const view=(props:Partial<React.ComponentProps<typeof AccountControls>>={})=>render(<NextIntlClientProvider locale="en" messages={{memberAdmin:{cancel:'Cancel',confirm:'Confirm'}}}><AccountControls scope={{kind:'central'}} actorId="another-admin" userId={userId} onChanged={async()=>{}} {...props}/></NextIntlClientProvider>);
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('account login controls',()=>{
 it('requires the explicit deletion phrase and clearly retains academic history',async()=>{
  const posted:Record<string,unknown>[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>{if(init?.method==='POST'){posted.push(JSON.parse(String(init.body)));return data({status:'complete'});}return data(state);}));
  const user=userEvent.setup();view();await user.click(await screen.findByRole('button',{name:'Delete login'}));
  const dialog=screen.getByRole('dialog');expect(within(dialog).getByText(/Academic records, roles and audit history remain/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button',{name:'Delete login'}));expect(posted).toHaveLength(0);
  await user.type(within(dialog).getByLabelText('Confirmation'),'DELETE LOGIN');await user.click(within(dialog).getByRole('button',{name:'Delete login'}));
  await waitFor(()=>expect(posted).toHaveLength(1));expect(posted[0]).toMatchObject({action:'delete',confirmation:'DELETE LOGIN'});
 });
 it('retries the stored operation without changing action or target',async()=>{
  const posted:Record<string,unknown>[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>{if(init?.method==='POST'){posted.push(JSON.parse(String(init.body)));return data({status:'complete'});}return data({...state,status:'disabled',operation:{id:'stored-id',action:'delete'}});}));
  const user=userEvent.setup();view();await user.click(await screen.findByRole('button',{name:'Retry pending change'}));
  expect(posted[0]).toEqual({action:'retry',operationId:'stored-id'});expect(screen.queryByRole('button',{name:'Enable login'})).not.toBeInTheDocument();
 });
 it('protects the signed-in administrator in the UI',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>data(state)));view({actorId:userId});expect(await screen.findByRole('button',{name:'Disable login'})).toBeDisabled();expect(screen.getByRole('button',{name:'Delete login'})).toBeDisabled();
 });
 it('explains Google invitation versus email backup creation and never returns a password',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>data({status:'complete'})));view({userId:undefined});expect(screen.getByText(/does not link Google by matching email/)).toBeInTheDocument();
  const user=userEvent.setup();await user.type(screen.getByLabelText('Display name'),'New person');await user.type(screen.getByLabelText('Email'),'new@example.com');await user.click(screen.getByRole('button',{name:'Create email backup account'}));expect(await screen.findByText(/No password is shared with administrators/)).toBeInTheDocument();
 });
});
