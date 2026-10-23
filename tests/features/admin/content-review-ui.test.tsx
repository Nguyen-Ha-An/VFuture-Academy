// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {NextIntlClientProvider} from 'next-intl';
import {afterEach,beforeAll,describe,it,expect,vi} from 'vitest';
import en from '@/messages/en.json';
import {staffUiTestMessages} from '@/messages/staff-ui';
import {ContentInventory,ReviewQueue,reviewChanges,type ReviewRow} from '@/features/admin/components/ContentReviewWorkspace';
const navigation=vi.hoisted(()=>({refresh:vi.fn(),replace:vi.fn(),search:''}));
// The library keeps search, filters and page in the URL, so it also reads the path and query.
vi.mock('next/navigation',()=>({useRouter:()=>navigation,usePathname:()=>'/studio/library',useSearchParams:()=>new URLSearchParams(navigation.search)}));
const messages=staffUiTestMessages(en,'en');
beforeAll(()=>{
 globalThis.ResizeObserver??=class{observe(){}unobserve(){}disconnect(){}} as unknown as typeof ResizeObserver;
 Element.prototype.scrollIntoView??=function scrollIntoView(){};
 Element.prototype.hasPointerCapture??=()=>false;
 Element.prototype.releasePointerCapture??=()=>{};
});
const props={scope:{kind:'central' as const},actorId:'operator',branches:[{id:'ans',name:'ANS'}]};
const row:ReviewRow={id:'00000000-0000-4000-8000-000000000001',content_type:'resource',content_id:'guide',status:'pending',owner_branch_id:null,submitted_at:'2026-09-06T00:00:00Z',decision_note:null,self_review:false,revision_key:'v2',checksum:'checksum',dependencies:[]};
function provider(content:React.ReactNode){return <NextIntlClientProvider locale="en" messages={messages}>{content}</NextIntlClientProvider>;}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();navigation.search='';});
describe('Central review interface',()=>{
 it('shows exact submitted content and changes before a decision, escaping source text',async()=>{
  const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({data:{review:row,snapshot:{revision_key:'v2',ownership_kind:'central',owner_branch_id:null,audience:{scope:'global'},dependencies:[]},reviewed_source:{title:'<img src=x onerror=alert(1)>',summary:'New text'},published_snapshot:{source:{title:'Old title',summary:'Old text'},revision_key:'v1'}}}),{headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetch);
  render(provider(<ReviewQueue {...props} rows={[row]} canReview canPublish/>));
  await userEvent.click(screen.getByRole('button',{name:'Read submitted version'}));
  expect(await screen.findByRole('heading',{name:'Read submitted version: guide'})).toBeInTheDocument();
  expect(screen.getByText('Review snapshot')).toBeInTheDocument();
  expect(screen.getByRole('tabpanel',{name:'Read submitted version'})).toHaveAttribute('aria-labelledby','review-preview-tab');
  await userEvent.click(screen.getByRole('tab',{name:'Changes from the published version'}));
  expect(screen.getByRole('heading',{name:'Changes from the published version'})).toBeInTheDocument();
  expect(screen.getByText('Old title')).toBeInTheDocument();expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(String(fetch.mock.calls[0]?.[0])).toContain('actorId=operator');
 });
 it('requires a review note before the atomic approval and publication request',async()=>{
  const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({data:{status:'published'}})));vi.stubGlobal('fetch',fetch);
  render(provider(<ReviewQueue {...props} rows={[row]} canReview canPublish/>));
  await userEvent.click(screen.getByRole('button',{name:'Approve and publish'}));const dialog=screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button',{name:'Approve and publish'}));expect(fetch).not.toHaveBeenCalled();
  await userEvent.type(within(dialog).getByLabelText('Review note (required)'),'Checked source and audience');await userEvent.click(within(dialog).getByRole('button',{name:'Approve and publish'}));
  await waitFor(()=>expect(navigation.refresh).toHaveBeenCalled());expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/approve-and-publish?scope=central&actorId=operator'),expect.objectContaining({method:'POST',body:JSON.stringify({expectedRevision:'v2',note:'Checked source and audience'})}));
 });
 it('does not expose Central decisions or snapshot loading to school reviewers',()=>{
  render(provider(<ReviewQueue {...props} scope={{kind:'branch',branchId:'ans'}} rows={[row]} canReview={false} canPublish={false}/>));
  expect(screen.queryByRole('button',{name:'Approve version'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Read submitted version'})).not.toBeInTheDocument();
 });
 it('keeps a changes request actionable when the server reports a stale review with HTTP 200',async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({data:{status:'stale'}})));vi.stubGlobal('fetch',fetch);
  render(provider(<ReviewQueue {...props} rows={[row]} canReview canPublish={false}/>));
  await userEvent.click(screen.getByRole('button',{name:'Request changes'}));
  const dialog=screen.getByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Decision note'),'Update the links');
  await userEvent.click(within(dialog).getByRole('button',{name:'Confirm'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Resubmit for review');
  expect(navigation.refresh).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Request changes'})).toBeEnabled();
 });
 it('renders only allowed creation and review controls with title, owner and audience',()=>{
  render(provider(<ContentInventory {...props} creatableTypes={['resource']} requestableKeys={[]} rows={[{...row,title:{en:'Student guide'},audience:{scope:'branches',branchIds:['ans']},ownership_kind:'central',owner_branch_id:null,updated_at:'2026-09-06T00:00:00Z',review_status:null,studio_href:'/admin/resources/guide'}]}/>));
  expect(screen.getByRole('link',{name:'Create resource'})).toBeInTheDocument();expect(screen.queryByRole('link',{name:'Create course'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Request review'})).not.toBeInTheDocument();
  expect(screen.getByText('Student guide')).toBeInTheDocument();expect(screen.getByText('ANS')).toBeInTheDocument();
 });
 it('loads a library workflow only when expanded and withdraws a pending review',async()=>{
  const workflow={content:{contentType:'resource',contentId:'guide',revisionKey:'v2',status:'draft',publishedRevisionKey:null},activeReview:{id:'review-1',status:'pending',revisionKey:'v2',note:null},publication:null,actions:{requestReview:false,withdrawReview:true,approveAndPublish:false,mutate:false}};
  const editable={...workflow,activeReview:null,actions:{...workflow.actions,requestReview:true,withdrawReview:false,mutate:true}};
  let withdrawn=false;
  const fetch=vi.fn(async(input:RequestInfo|URL)=>{
   const url=String(input);
   if(url.includes('/withdraw')) {withdrawn=true;return new Response(JSON.stringify({data:{status:'withdrawn'}}));}
   return new Response(JSON.stringify({data:withdrawn?editable:workflow}));
  });
  vi.stubGlobal('fetch',fetch);
  render(provider(<ContentInventory {...props} creatableTypes={[]} requestableKeys={[]} rows={[{...row,title:'Guide',audience:{scope:'global'},ownership_kind:'central',updated_at:'2026-09-06T00:00:00Z',review_status:'pending',studio_href:'/studio/resources/guide'}]}/>));
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'Review workflow'})).not.toBeInTheDocument();
  // The workflow moved from an expandable row into a Sheet opened from the row's "…" menu.
  fireEvent.pointerDown(screen.getByRole('button',{name:'Actions for Guide'}),{button:0,ctrlKey:false});
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem',{name:'Review workflow'}));
  expect(await screen.findByRole('dialog',{name:'Review workflow'})).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button',{name:'Withdraw to edit'}));
  await waitFor(()=>expect(fetch.mock.calls.some(([url])=>String(url).includes('/reviews/review-1/withdraw'))).toBe(true));
  expect(screen.getByText('Editable')).toBeInTheDocument();
 });
 it('includes added, removed and changed values in the immutable diff',()=>{
  expect(reviewChanges({title:'old',removed:1},{title:'new',added:2})).toEqual([{field:'added',before:'—',after:'2'},{field:'removed',before:'1',after:'—'},{field:'title',before:'old',after:'new'}]);
 });
});
