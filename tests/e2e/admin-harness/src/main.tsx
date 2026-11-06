import { lazy, Suspense, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { usePathname } from 'next/navigation';
import { AdminShell } from '@/components/AdminShell';
import { AppShell } from '@/components/AppShell';
import { CanvasProvider } from '@/features/canvas/ui';
import { StudioShell } from '@/components/StudioShell';
import { MembersDirectory } from '@/features/admin/components/MembersDirectory';
import { MemberProfile } from '@/features/admin/components/MemberProfile';
import { McpBlockView } from '@/features/admin/components/McpBlockView';
import { ContentInventory, ReviewQueue, type ReviewRow, type ReviewPreview } from '@/features/admin/components/ContentReviewWorkspace';
import { RoleManager } from '@/features/admin/components/RoleManager';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import AdminLoading from '@/app/admin/loading';
import AdminError from '@/app/admin/error';
import { AdminForbidden } from '@/features/admin/ui/AdminForbidden';
import { EnrollmentMigrationPanel } from '@/features/enrollment/EnrollmentMigrationPanel';
import { createAdminTransport, FIXTURE_ACTOR_ID, FIXTURE_PEOPLE, FIXTURE_SCHOOLS } from './admin-transport';
import { createSupportTransport } from '../../support/support-transport';
import { teacherTransport } from './teacher-transport';
import { canonicalPreviewUrl } from './canonical-routes';
import { BUILT_IN_ROLE_PERMISSIONS, type Permission } from '@/lib/authorization';
import { scopeKey, type AdminScope } from '@/lib/admin-scope';
import type { MemberSummary, ManagedRoleDefinition } from '@/features/admin/management-contracts';
import viBase from '@/messages/vi.json';
import enBase from '@/messages/en.json';
import { withStaffUiMessages } from '@/messages/staff-ui';
import { withBenchMessages } from '@/messages/bench';
import '@/app/fonts.css';
import '@/app/globals.css';
const vi=withStaffUiMessages(viBase,'vi');
const params=new URLSearchParams(location.search);
function remembered(name:string,fallback:string){const value=params.get(name);if(value!==null)sessionStorage.setItem(`admin-fixture-${name}`,value);return value??sessionStorage.getItem(`admin-fixture-${name}`)??fallback;}
const locale=remembered('lang','vi')==='en'?'en':'vi';
const scenario=remembered('scenario','dense');
params.set('scenario',scenario);
if(scenario==='error'&&!params.has('fail'))params.set('fail','members');
if(scenario==='busy'&&!params.has('busy'))params.set('busy','members');
const azure=process.env.NEXT_PUBLIC_ACADEMY_BACKEND==='azure';
const messages=withBenchMessages(locale==='en'?withStaffUiMessages(enBase,'en'):vi,locale);
document.documentElement.lang=locale;
// `?uiv2=1` renders the Catmin StaffWorkspaceShell (UI_V2_SURFACES) with the same entries, permissions and scopes.
// Full page loads (plain-anchor links) drop the query string; remember the flag for the tab.
const staffUi=(()=>{const flag=new URLSearchParams(location.search).get('uiv2');try{if(flag!==null)sessionStorage.setItem('harness-uiv2',flag);return (flag??sessionStorage.getItem('harness-uiv2'))==='1';}catch{return flag==='1';}})();
const StaffHarnessShell=lazy(()=>import('../../studio-harness/src/staff-shell-fixture').then(module=>({default:module.StaffHarnessShell})));
// The Catmin admin page views (PR 3-5) with fixture data, loaded only on their own routes.
const pagesFixture=()=>import('./admin-pages-fixture');
const AdminOverviewFixture=lazy(()=>pagesFixture().then(module=>({default:module.AdminOverviewFixture})));
const BranchesFixture=lazy(()=>pagesFixture().then(module=>({default:module.BranchesFixture})));
const SchoolDetailFixture=lazy(()=>pagesFixture().then(module=>({default:module.SchoolDetailFixture})));
const SchoolEntryFixture=lazy(()=>pagesFixture().then(module=>({default:module.SchoolEntryFixture})));
const AuditFixture=lazy(()=>pagesFixture().then(module=>({default:module.AuditFixture})));
const SupportProfileFixture=lazy(()=>import('./support-profile-fixture').then(module=>({default:module.SupportProfileFixture})));
const TIME_ZONE='Asia/Ho_Chi_Minh';
const entries={studio:'/studio',grading:'/grading',admin:'/admin'};
const school={id:'ans',name:'ANS · Hà Nội'};
function fixtureScopes(){return[{scope:{kind:'central' as const},label:'Central',permissions:[...BUILT_IN_ROLE_PERMISSIONS.central_admin] as Permission[]},
 ...(window.__adminFixture?.readModel().schools??FIXTURE_SCHOOLS).map(branch=>({scope:{kind:'branch' as const,branchId:branch.id},label:branch.name,permissions:[...BUILT_IN_ROLE_PERMISSIONS.school_admin] as Permission[]}))];}
const initialScope=remembered('scope','central');
let active:AdminScope=initialScope.startsWith('branch:')?{kind:'branch',branchId:initialScope.slice(7)}:{kind:'central'};
const roles:ManagedRoleDefinition[]=Object.entries(BUILT_IN_ROLE_PERMISSIONS).map(([id,permissions])=>({id,name:id.replaceAll('_',' '),description:'',scopeKind:id.startsWith('central')?'central':'branch',permissions:[...permissions],builtIn:true,grantableBySchool:['teacher','school_editor','member'].includes(id),version:1,assignmentCount:2}));
const members:MemberSummary[]=FIXTURE_PEOPLE.map(([id,displayName,email],index)=>({id,displayName,email,handle:null,branchId:'ans',accountStatus:index===9?'suspended':'active',createdAt:'2026-09-01T08:00:00Z',memberships:[{branchId:'ans',branchName:school.name,status:'active',isPrimary:true}],assignments:index%7===3?[{id:`assignment-${index}`,roleId:'teacher',roleName:'Giáo viên',scope:{kind:'branch',branchId:'ans'},grantedAt:'2026-09-01T08:00:00Z',grantedBy:null}]:[]}));
if(scenario==='long'){members[0].displayName='Nguyễn Hoàng Minh Anh — Chương trình nghiên cứu trí tuệ nhân tạo / Artificial intelligence research programme';members[0].email='very.long.bilingual.member.identity@example.test';}
if(scenario==='multi-school'){members[0].memberships.push({branchId:'dewey',branchName:'Dewey · Cầu Giấy',status:'active',isPrimary:false});members[1].branchId='dewey';members[1].memberships=[{branchId:'dewey',branchName:'Dewey · Cầu Giấy',status:'active',isPrimary:true}];}
roles.push({id:'school-mentor',name:locale==='vi'?'Cố vấn dự án':'Project mentor',description:locale==='vi'?'Xem thành viên và hỗ trợ học tập tại trường.':'Read school members and support learning.',scopeKind:'branch',permissions:['member.read','learning.read'],builtIn:false,grantableBySchool:true,version:3,assignmentCount:2});
/** Directory KPI row, as member-stats.ts returns it (no deltas). */
function memberStats(scope:AdminScope){const model=window.__adminFixture.readModel(scope),rows=model.members;return{members:rows.length,learners:rows.filter(member=>!member.assignments.length).length,suspended:rows.filter(member=>member.accountStatus==='suspended').length,pendingInvitations:model.invitations.filter(invitation=>invitation.status==='pending').length};}
const mcpBlocks = new Map<string, { reason: string | null; blockedAt: string }>();
const reviewReturnParams = new URL(params.get('returnTo') ?? '/studio/reviews', location.origin).searchParams;
let failPublishOnce = params.has('failPublishOnce') || reviewReturnParams.has('failPublishOnce');
const holdScope = new URLSearchParams(location.search).has('holdScope');
const review:ReviewRow={id:'00000000-0000-4000-8000-000000000105',content_type:'resource',content_id:'huong-dan-hoc-tap',status:'pending',owner_branch_id:null,submitted_at:'2026-09-06T08:00:00Z',decision_note:null,self_review:false,revision_key:'v2',checksum:'review-checksum',dependencies:[]};
// `?reviews=many` queues more requests, so the master-detail layout has something to choose between.
const manyReviews=params.get('reviews')==='many'||reviewReturnParams.get('reviews')==='many';
const extraReviews:ReviewRow[]=manyReviews?([['course','python-co-ban','Python cơ bản'],['opportunity','hoc-bong-mua-thu','Học bổng mùa thu 2026'],['project','vuon-truong-thong-minh','Vườn trường thông minh']] as const).map(([content_type,content_id],index)=>({...review,id:`00000000-0000-4000-8000-00000000011${index}`,content_type,content_id,submitted_at:`2026-09-0${7+index}T08:00:00Z`,revision_key:'v1',checksum:`review-checksum-${index}`})):[];
const reviewTitles:Record<string,{vi:string}>={'huong-dan-hoc-tap':{vi:'Hướng dẫn học tập'},'python-co-ban':{vi:'Python cơ bản'},'hoc-bong-mua-thu':{vi:'Học bổng mùa thu 2026'},'vuon-truong-thong-minh':{vi:'Vườn trường thông minh'}};
/** Library rows: the reviewed resource plus 29 more, so the 25-row pages show an honest total. */
const libraryTitles=['Python cơ bản','Nền tảng trí tuệ nhân tạo','Tư duy thiết kế','Khoa học dữ liệu nhập môn','Lập trình web với React','Toán rời rạc ứng dụng','Kỹ năng thuyết trình','Tiếng Anh học thuật','Robot và vi điều khiển','An toàn thông tin số'];
const libraryTypes=['course','resource','opportunity','project'] as const;
const libraryRows=[{content_type:'resource',content_id:review.content_id,title:{vi:'Hướng dẫn học tập'},audience:{scope:'global'},status:'published',ownership_kind:'central' as const,owner_branch_id:null,updated_at:review.submitted_at,revision_key:'v2',review_status:review.status,studio_href:'/studio/resources/huong-dan-hoc-tap'},
 ...Array.from({length:29},(_,index)=>{const content_type=libraryTypes[index%libraryTypes.length];const content_id=`noi-dung-${index+1}`;return {content_type,content_id,title:{vi:`${libraryTitles[index%libraryTitles.length]}${index>=libraryTitles.length?` · phần ${Math.floor(index/libraryTitles.length)+1}`:''}`},audience:{scope:'global'},status:index%5===0?'draft':index%11===0?'archived':'published',ownership_kind:(index%4===3?'branch':'central') as 'branch'|'central',owner_branch_id:index%4===3?'ans':null,updated_at:`2026-09-${String(24-(index%20)).padStart(2,'0')}T0${index%10}:00:00Z`,revision_key:`v${1+index%3}`,review_status:index%6===2?'pending':index%9===4?'changes_requested':null,studio_href:`/studio/${content_type==='course'?'courses':`${content_type}s`}/${content_id}`};})];
const fixturePermissions=()=>{
 const granted=fixtureScopes().find(option=>scopeKey(option.scope)===scopeKey(active))!.permissions;
 return scenario==='read-only'?granted.filter(permission=>permission==='admin.access'||permission.endsWith('.read')):granted;
};
const adminTransport=createAdminTransport({members,roles,getScope:()=>active,getPermissions:fixturePermissions,azure,search:params});
if(!fixtureScopes().some(option=>scopeKey(option.scope)===scopeKey(active)))active={kind:'central'};
// Isolated test transports: no production server, credentials or network mutation.
window.fetch=async(input,init)=>{
 const response=await adminTransport(input,init);if(response)return response;
 const url=new URL(String(input),location.origin);const body=init?.body?JSON.parse(String(init.body)):{};
 let data:unknown;
 if(/^\/api\/v1\/(admin|studio|grading)\/scope$/.test(url.pathname)){
   const failure=(status:number,code:string,message:string)=>new Response(JSON.stringify({error:{code,message}}),{status,headers:{'Content-Type':'application/json'}});
   if(init?.method!=='POST'||Object.keys(body).some(key=>key!=='scope'))return failure(400,'INVALID_OPERATION','Scope changes require the exact production POST body.');
   if(url.searchParams.has('actorId')&&url.searchParams.get('actorId')!==FIXTURE_ACTOR_ID)return failure(409,'ACTOR_CHANGED','The fixture operator changed.');
   if(url.searchParams.has('scope')&&url.searchParams.get('scope')!==scopeKey(active))return failure(409,'SCOPE_CHANGED','The fixture scope changed.');
   const expected=new Headers(init?.headers).get('x-vfuture-expected-saved-scope');
   if(expected!==null&&expected!==(sessionStorage.getItem('admin-fixture-scope')??''))return failure(409,'SCOPE_CHANGED','The saved fixture scope changed.');
   const option=fixtureScopes().find(option=>scopeKey(option.scope)===body.scope);
   if(!option)return failure(403,'FORBIDDEN','Scope not available to this fixture operator');
   // Hold only an otherwise authorized POST, preserving the rejection contracts.
   if(holdScope)return new Promise<Response>(()=>{});
   window.__adminFixture.requests.push({path:url.pathname,method:'POST',scope:scopeKey(active),body});
   active=option.scope;sessionStorage.setItem('admin-fixture-scope',body.scope);window.dispatchEvent(new Event('admin-demo-scope'));data={scope:body.scope};
 }
 else if(url.pathname.endsWith('/mcp/blocks')){if(active.kind!=='central'||!fixturePermissions().includes('user.manage.global'))return new Response(JSON.stringify({error:{code:'FORBIDDEN',message:'Central user management permission required'}}),{status:403,headers:{'Content-Type':'application/json'}});const userId=(init?.method==='POST'||init?.method==='DELETE'?body.userId:url.searchParams.get('userId')) as string;if(init?.method==='POST')mcpBlocks.set(userId,{reason:body.reason??null,blockedAt:new Date().toISOString()});if(init?.method==='DELETE')mcpBlocks.delete(userId);const block=mcpBlocks.get(userId);data={userId,blocked:Boolean(block),reason:block?.reason??null,blockedAt:block?.blockedAt??null,blockedBy:block?FIXTURE_ACTOR_ID:null,scope:'all-mcp-clients',oauthGrantRevoked:false};}
 else if(url.pathname.endsWith('/workflow')){const [,contentType,contentId]=/\/content\/([^/]+)\/([^/]+)\/workflow$/.exec(url.pathname)??[];const row=libraryRows.find(entry=>entry.content_type===contentType&&entry.content_id===contentId);data={content:{contentType,contentId,revisionKey:row?.revision_key??'v1',status:row?.status??'draft',publishedRevisionKey:row?.status==='published'?row.revision_key:null},activeReview:row?.review_status==='pending'?{id:review.id,status:'pending',revisionKey:row.revision_key}:null,publication:null,actions:{requestReview:row?.review_status!=='pending',withdrawReview:false,approveAndPublish:false,mutate:true}};}
 else if(url.pathname.includes('/reviews/')){
   if(init?.method==='POST'&&(url.pathname.endsWith('/publish') || url.pathname.endsWith('/approve-and-publish'))&&failPublishOnce){failPublishOnce=false;return new Response(JSON.stringify({error:{message:'Không lưu được lần xuất bản này. Hãy thử lại.'}}),{status:503,headers:{'Content-Type':'application/json'}});}
   if(init?.method==='POST'){review.status=(url.pathname.endsWith('/publish') || url.pathname.endsWith('/approve-and-publish'))?'published':body.decision==='approve'?'approved':'changes_requested';review.decision_note=body.note??null;data={status:review.status};window.dispatchEvent(new Event('admin-demo-update'));}
   else if(extraReviews.some(entry=>url.pathname.includes(entry.id))){const extra=extraReviews.find(entry=>url.pathname.includes(entry.id))!;const title=reviewTitles[extra.content_id]!;data={review:extra,snapshot:{revision_key:extra.revision_key,ownership_kind:'central',owner_branch_id:null,audience:{scope:'global'},dependencies:[]},reviewed_source:{document:{title,summary:{vi:`Bản gửi duyệt đầu tiên của ${title.vi}.`},body:{vi:{blocks:[{type:'paragraph',content:[{text:`Nội dung ${title.vi} dành cho học sinh THPT, gồm mục tiêu, hoạt động và tiêu chí đánh giá.`}]}]}}}},published_snapshot:null};}
   else data={review,snapshot:{revision_key:'v2',ownership_kind:'central',owner_branch_id:null,audience:{scope:'global'},dependencies:[]},reviewed_source:{document:{title:{vi:'Hướng dẫn học tập',en:'Learning guide'},summary:{vi:'Cách chuẩn bị bài và nộp bài đúng hạn.'},body:{vi:{blocks:[{type:'paragraph',content:[{text:'Học viên hoàn thành bài đọc trước buổi học và nộp bài vào thứ Sáu.'}]}]}}}},published_snapshot:{revision_key:'v1',source:{document:{title:{vi:'Hướng dẫn học tập'},summary:{vi:'Hướng dẫn cũ'},body:{vi:{blocks:[{type:'paragraph',content:[{text:'Nộp bài vào thứ Năm.'}]}]}}}}}};
 }
 if(data===undefined)return new Response(JSON.stringify({error:{code:'FIXTURE_NOT_IMPLEMENTED',message:`This fixture does not implement ${url.pathname}`}}),{status:501,headers:{'Content-Type':'application/json'}});
 return new Response(JSON.stringify({data}),{status:200,headers:{'Content-Type':'application/json'}});
};
window.fetch=teacherTransport(createSupportTransport(window.fetch.bind(window)));
function ReviewDetailFixture({ reviewId, ...props }: Parameters<typeof ReviewQueue>[0] & { reviewId: string }) {
 const [initialReview, setInitialReview] = useState<ReviewPreview>();
 useEffect(() => { let current = true; void fetch(`/api/v1/studio/reviews/${encodeURIComponent(reviewId)}`).then(response => response.json()).then(payload => { if (current) setInitialReview(payload.data); }); return () => { current = false; }; }, [reviewId]);
 return initialReview ? <ReviewQueue {...props} initialReview={initialReview} returnHref={params.get('returnTo') ?? undefined} /> : <p role="status">Loading review fixture…</p>;
}
function App(){
 const pathname=usePathname();const [scope,setScope]=useState(active);const [,setRevision]=useState(0);
 useEffect(()=>{const update=()=>setRevision(value=>value+1);window.addEventListener('admin-demo-update',update);return()=>window.removeEventListener('admin-demo-update',update);},[]);
 useEffect(()=>{const update=()=>setScope(active);window.addEventListener('admin-demo-scope',update);return()=>window.removeEventListener('admin-demo-scope',update);},[]);
 useEffect(()=>{const target=canonicalPreviewUrl(pathname,location.search);if(target)location.replace(target);},[pathname]);
 const permissions=fixturePermissions();
 const scopes=fixtureScopes();
 const shared={scope,actorId:FIXTURE_ACTOR_ID,branches:window.__adminFixture.readModel(scope).schools};
 const central=scope.kind==='central';
 const boundary=params.get('boundary');
 const content=boundary==='loading'?<AdminLoading/>:boundary==='forbidden'?<AdminForbidden/>:boundary==='error'?<AdminError error={new Error('Local fixture read failed')} reset={()=>{const next=new URL(location.href);next.searchParams.delete('boundary');location.assign(next.href);}}/>
  :pathname==='/app/profile'?<Suspense fallback={null}><SupportProfileFixture/></Suspense>
  :pathname==='/account/school-context'?<Suspense fallback={null}><SchoolEntryFixture scope={scope} scopeOptions={scopes}/></Suspense>
  :pathname==='/grading/reports'?null
  :pathname==='/admin/enrollment-migration'?permissions.includes('course.publish')?<EnrollmentMigrationPanel courses={scenario==='empty'?[]:[{id:'python-foundations',title:locale==='vi'?'Python cơ bản':'Python foundations'},{id:'ai-foundations',title:locale==='vi'?'Nền tảng trí tuệ nhân tạo':'AI foundations'}]}/>:<AdminForbidden/>
  :pathname==='/studio/reviews'?<section className="space-y-6"><StaffPageHeader title="Duyệt nội dung"/><ReviewQueue {...shared} rows={[review,...extraReviews]} canReview={central} canPublish={central} titles={manyReviews?Object.fromEntries([review,...extraReviews].map(entry=>[`${entry.content_type}:${entry.content_id}`,reviewTitles[entry.content_id]])):undefined} submitters={manyReviews?{}:undefined}/></section>
  :pathname.startsWith('/studio/reviews/')?<ReviewDetailFixture {...shared} reviewId={pathname.split('/').at(-1)!} rows={[review,...extraReviews]} canReview={central} canPublish={central} titles={manyReviews?Object.fromEntries([review,...extraReviews].map(entry=>[`${entry.content_type}:${entry.content_id}`,reviewTitles[entry.content_id]])):undefined}/>
  :pathname==='/studio/library'?<section className="space-y-6"><ContentInventory {...shared} title="Thư viện nội dung" creatableTypes={['resource']} requestableKeys={libraryRows.map(row=>`${row.content_type}:${row.content_id}`)} rows={libraryRows}/></section>
  :pathname==='/admin/roles'?<RoleManager scope={scope} actorId={FIXTURE_ACTOR_ID}/>
  :pathname==='/admin/mcp'?central&&permissions.includes('user.manage.global')?<McpBlockView initialUserId={new URLSearchParams(location.search).get('userId')??''} actorId={FIXTURE_ACTOR_ID}/>:<AdminForbidden/>
  :pathname==='/admin'?<Suspense fallback={null}><AdminOverviewFixture permissions={permissions} entries={entries} central={central} scope={scope}/></Suspense>
  :pathname==='/admin/branches'?<Suspense fallback={null}><BranchesFixture canManage={permissions.includes('branch.manage')} scope={scope} permissions={permissions}/></Suspense>
  :pathname.startsWith('/admin/branches/')?scopes.some(option=>option.scope.kind==='branch'&&option.scope.branchId===pathname.split('/').at(-1))?<Suspense fallback={null}><SchoolDetailFixture branchId={pathname.split('/').at(-1)!} permissions={permissions} scope={scope} scopeOptions={scopes}/></Suspense>:<AdminForbidden/>
  :pathname==='/admin/audit'?<Suspense fallback={null}><AuditFixture/></Suspense>
  :pathname.startsWith('/admin/users/')?<MemberProfile userId={pathname.split('/').at(-1)!} scope={scope} actorId={FIXTURE_ACTOR_ID} canManageMcpAccess={central&&permissions.includes('user.manage.global')}/>
  :pathname==='/admin/users'?<MembersDirectory scope={scope} actorId={FIXTURE_ACTOR_ID} stats={memberStats(scope)}/>
  :<section><h1>Fixture route unavailable</h1><p>{pathname} is not a rendered Admin screen.</p></section>;
 if(pathname==='/app/profile')return <NextIntlClientProvider locale={locale} messages={messages} timeZone={TIME_ZONE}><AppShell userName="Nguyễn Minh Anh" initials="MA" theme={new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light'}>{content}</AppShell></NextIntlClientProvider>;
 if(pathname==='/account/school-context')return <NextIntlClientProvider locale={locale} messages={messages} timeZone={TIME_ZONE}><CanvasProvider>{content}</CanvasProvider></NextIntlClientProvider>;
 if(staffUi)return <NextIntlClientProvider locale={locale} messages={messages} timeZone={TIME_ZONE}><Suspense fallback={null}><StaffHarnessShell workspace={pathname.startsWith('/studio/')?'studio':'admin'} entries={entries} key={scopeKey(scope)} permissions={permissions} activeScope={scope} scopeOptions={scopes}>{content}</StaffHarnessShell></Suspense></NextIntlClientProvider>;
 const Shell=pathname.startsWith('/studio/')?StudioShell:AdminShell;
 return <NextIntlClientProvider locale={locale} messages={messages} timeZone={TIME_ZONE}><Shell redesigned={new URLSearchParams(location.search).has('redesigned')} entries={entries} key={scopeKey(scope)} permissions={permissions} activeScope={scope} scopeOptions={scopes} userName="Người quản trị thử nghiệm">{content}</Shell></NextIntlClientProvider>;
}
const canonical=canonicalPreviewUrl(location.pathname,location.search);
if(canonical)location.replace(canonical);else createRoot(document.getElementById('root')!).render(<App/>);
