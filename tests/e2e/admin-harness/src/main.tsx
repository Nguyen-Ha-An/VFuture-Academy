import { lazy, Suspense, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { usePathname } from 'next/navigation';
import { AdminShell } from '@/components/AdminShell';
import { StudioShell } from '@/components/StudioShell';
import { MembersDirectory } from '@/features/admin/components/MembersDirectory';
import { MemberProfile } from '@/features/admin/components/MemberProfile';
import { McpBlockView } from '@/features/admin/components/McpBlockView';
import { ContentInventory, ReviewQueue, type ReviewRow } from '@/features/admin/components/ContentReviewWorkspace';
import { RoleManager } from '@/features/admin/components/RoleManager';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { BUILT_IN_ROLE_PERMISSIONS, type Permission } from '@/lib/authorization';
import { scopeKey, type AdminScope } from '@/lib/admin-scope';
import type { MemberSummary, MemberDetail, ManagedRoleDefinition } from '@/features/admin/management-contracts';
import viBase from '@/messages/vi.json';
import { withStaffUiMessages } from '@/messages/staff-ui';
import '@/app/fonts.css';
import '@/app/globals.css';
const vi=withStaffUiMessages(viBase,'vi');
// `?uiv2=1` renders the Catmin StaffWorkspaceShell (UI_V2_SURFACES) with the same entries, permissions and scopes.
// Full page loads (plain-anchor links) drop the query string; remember the flag for the tab.
const staffUi=(()=>{const flag=new URLSearchParams(location.search).get('uiv2');try{if(flag!==null)sessionStorage.setItem('harness-uiv2',flag);return (flag??sessionStorage.getItem('harness-uiv2'))==='1';}catch{return flag==='1';}})();
const StaffHarnessShell=lazy(()=>import('../../studio-harness/src/staff-shell-fixture').then(module=>({default:module.StaffHarnessShell})));
// The Catmin admin page views (PR 3-5) with fixture data, loaded only on their own routes.
const pagesFixture=()=>import('./admin-pages-fixture');
const AdminOverviewFixture=lazy(()=>pagesFixture().then(module=>({default:module.AdminOverviewFixture})));
const BranchesFixture=lazy(()=>pagesFixture().then(module=>({default:module.BranchesFixture})));
const SchoolDetailFixture=lazy(()=>pagesFixture().then(module=>({default:module.SchoolDetailFixture})));
const AuditFixture=lazy(()=>pagesFixture().then(module=>({default:module.AuditFixture})));
const TIME_ZONE='Asia/Ho_Chi_Minh';
const entries={studio:'/studio',grading:'/grading',admin:'/admin'};
const school={id:'ans',name:'ANS · Hà Nội'};
const scopes=[{scope:{kind:'central' as const},label:'Central',permissions:[...BUILT_IN_ROLE_PERMISSIONS.central_admin] as Permission[]},
 {scope:{kind:'branch' as const,branchId:school.id},label:school.name,permissions:[...BUILT_IN_ROLE_PERMISSIONS.school_admin] as Permission[]}];
let active:AdminScope={kind:'central'};
const roles:ManagedRoleDefinition[]=Object.entries(BUILT_IN_ROLE_PERMISSIONS).map(([id,permissions])=>({id,name:id.replaceAll('_',' '),description:'',scopeKind:id.startsWith('central')?'central':'branch',permissions:[...permissions],builtIn:true,grantableBySchool:['teacher','school_editor','member'].includes(id),version:1,assignmentCount:2}));
const moreMembers=['Phạm Quốc Huy','Hoàng Ngọc Diệp','Vũ Đức Thắng','Đặng Thảo Vy','Bùi Khánh Linh','Đỗ Hải Nam','Ngô Phương Thảo','Dương Tuấn Kiệt','Lý Mỹ Duyên','Hồ Thanh Tùng','Mai Anh Thư','Trịnh Công Sơn','Phan Bảo Ngọc','Tạ Minh Khôi','Cao Thùy Linh','Lương Gia Huy','Châu Ngọc Hân','Tôn Nữ Minh Châu','Kiều Trọng Nghĩa','Quách Thảo Nguyên','Âu Dương Phong','Lâm Khánh Chi','Giang Hải Yến'].map((name,index)=>[`00000000-0000-4000-8000-${String(201+index).padStart(12,'0')}`,name,`hoc.vien${index+1}@example.test`]);
const members:MemberSummary[]=[['00000000-0000-4000-8000-000000000101','Nguyễn Minh Anh','minh.anh@example.test'],['00000000-0000-4000-8000-000000000102','Trần Gia Bảo','gia.bao@example.test'],['00000000-0000-4000-8000-000000000103','Lê Thu Hà','thu.ha@example.test'],...moreMembers].map(([id,displayName,email],index)=>({id,displayName,email,handle:null,branchId:'ans',accountStatus:index===9?'suspended':'active',createdAt:'2026-09-01T08:00:00Z',memberships:[{branchId:'ans',branchName:school.name,status:'active',isPrimary:true}],assignments:index%7===3?[{id:`assignment-${index}`,roleId:'teacher',roleName:'Giáo viên',scope:{kind:'branch',branchId:'ans'},grantedAt:'2026-09-01T08:00:00Z',grantedBy:null}]:[]}));
/** Directory KPI row, as member-stats.ts returns it (no deltas). */
const memberStats={members:1284,learners:1102,suspended:7,pendingInvitations:3};
// Two open invitations, so the invitations card shows its badges and inline Revoke/Reissue.
let invitations:unknown[]=[{id:'00000000-0000-4000-8000-000000000301',email:'thao.nguyen@example.test',branchId:'ans',roleId:'teacher',status:'pending',createdAt:'2026-09-20T08:00:00Z',expiresAt:'2026-09-27T08:00:00Z'},{id:'00000000-0000-4000-8000-000000000302',email:'quang.le@example.test',branchId:'ans',roleId:null,status:'expired',createdAt:'2026-09-01T08:00:00Z',expiresAt:'2026-09-08T08:00:00Z'}];
const mcpBlocks = new Map<string, { reason: string | null; blockedAt: string }>();
let failPublishOnce = new URLSearchParams(location.search).has('failPublishOnce');
const holdScope = new URLSearchParams(location.search).has('holdScope');
const review:ReviewRow={id:'00000000-0000-4000-8000-000000000105',content_type:'resource',content_id:'huong-dan-hoc-tap',status:'pending',owner_branch_id:null,submitted_at:'2026-09-06T08:00:00Z',decision_note:null,self_review:false,revision_key:'v2',checksum:'review-checksum',dependencies:[]};
// `?reviews=many` queues more requests, so the master-detail layout has something to choose between.
const manyReviews=new URLSearchParams(location.search).get('reviews')==='many';
const extraReviews:ReviewRow[]=manyReviews?([['course','python-co-ban','Python cơ bản'],['opportunity','hoc-bong-mua-thu','Học bổng mùa thu 2026'],['project','vuon-truong-thong-minh','Vườn trường thông minh']] as const).map(([content_type,content_id],index)=>({...review,id:`00000000-0000-4000-8000-00000000011${index}`,content_type,content_id,submitted_at:`2026-09-0${7+index}T08:00:00Z`,revision_key:'v1',checksum:`review-checksum-${index}`})):[];
const reviewTitles:Record<string,{vi:string}>={'huong-dan-hoc-tap':{vi:'Hướng dẫn học tập'},'python-co-ban':{vi:'Python cơ bản'},'hoc-bong-mua-thu':{vi:'Học bổng mùa thu 2026'},'vuon-truong-thong-minh':{vi:'Vườn trường thông minh'}};
/** Library rows: the reviewed resource plus 29 more, so the 25-row pages show an honest total. */
const libraryTitles=['Python cơ bản','Nền tảng trí tuệ nhân tạo','Tư duy thiết kế','Khoa học dữ liệu nhập môn','Lập trình web với React','Toán rời rạc ứng dụng','Kỹ năng thuyết trình','Tiếng Anh học thuật','Robot và vi điều khiển','An toàn thông tin số'];
const libraryTypes=['course','resource','opportunity','project'] as const;
const libraryRows=[{content_type:'resource',content_id:review.content_id,title:{vi:'Hướng dẫn học tập'},audience:{scope:'global'},status:'published',ownership_kind:'central' as const,owner_branch_id:null,updated_at:review.submitted_at,revision_key:'v2',review_status:review.status,studio_href:'/studio/resources/huong-dan-hoc-tap'},
 ...Array.from({length:29},(_,index)=>{const content_type=libraryTypes[index%libraryTypes.length];const content_id=`noi-dung-${index+1}`;return {content_type,content_id,title:{vi:`${libraryTitles[index%libraryTitles.length]}${index>=libraryTitles.length?` · phần ${Math.floor(index/libraryTitles.length)+1}`:''}`},audience:{scope:'global'},status:index%5===0?'draft':index%11===0?'archived':'published',ownership_kind:(index%4===3?'branch':'central') as 'branch'|'central',owner_branch_id:index%4===3?'ans':null,updated_at:`2026-09-${String(24-(index%20)).padStart(2,'0')}T0${index%10}:00:00Z`,revision_key:`v${1+index%3}`,review_status:index%6===2?'pending':index%9===4?'changes_requested':null,studio_href:`/studio/${content_type==='course'?'courses':`${content_type}s`}/${content_id}`};})];
// Isolated test transport: no production server, credentials or network mutation.
window.fetch=async(input,init)=>{
 const url=new URL(String(input),location.origin);const body=init?.body?JSON.parse(String(init.body)):{};
 const current=scopes.find(option=>scopeKey(option.scope)===scopeKey(active))!;
 let data:unknown={};
 // `?holdScope=1` leaves the scope POST in flight, so specs can inspect the switching overlay.
 if(url.pathname.endsWith('/scope')&&holdScope)return new Promise<Response>(()=>{});
 if(url.pathname.endsWith('/scope')){active=scopes.find(option=>scopeKey(option.scope)===body.scope)!.scope;window.dispatchEvent(new Event('admin-demo-scope'));}
 else if(url.pathname.endsWith('/mcp/blocks')){const userId=(init?.method==='POST'||init?.method==='DELETE'?body.userId:url.searchParams.get('userId')) as string;if(init?.method==='POST')mcpBlocks.set(userId,{reason:body.reason??null,blockedAt:new Date().toISOString()});if(init?.method==='DELETE')mcpBlocks.delete(userId);const block=mcpBlocks.get(userId);data={userId,blocked:Boolean(block),reason:block?.reason??null,blockedAt:block?.blockedAt??null,blockedBy:block?'demo-operator':null,scope:'all-mcp-clients',oauthGrantRevoked:false};}
 else if(url.pathname.endsWith('/workflow')){const [,contentType,contentId]=/\/content\/([^/]+)\/([^/]+)\/workflow$/.exec(url.pathname)??[];const row=libraryRows.find(entry=>entry.content_type===contentType&&entry.content_id===contentId);data={content:{contentType,contentId,revisionKey:row?.revision_key??'v1',status:row?.status??'draft',publishedRevisionKey:row?.status==='published'?row.revision_key:null},activeReview:row?.review_status==='pending'?{id:review.id,status:'pending',revisionKey:row.revision_key}:null,publication:null,actions:{requestReview:row?.review_status!=='pending',withdrawReview:false,approveAndPublish:false,mutate:true}};}
 else if(url.pathname.endsWith('/options'))data={scope:active,branches:[school],roles:active.kind==='central'?roles:roles.filter(role=>role.grantableBySchool),permissions:current.permissions};
 else if(url.pathname.includes('/reviews/')){
   if(init?.method==='POST'&&(url.pathname.endsWith('/publish') || url.pathname.endsWith('/approve-and-publish'))&&failPublishOnce){failPublishOnce=false;return new Response(JSON.stringify({error:{message:'Không lưu được lần xuất bản này. Hãy thử lại.'}}),{status:503,headers:{'Content-Type':'application/json'}});}
   if(init?.method==='POST'){review.status=(url.pathname.endsWith('/publish') || url.pathname.endsWith('/approve-and-publish'))?'published':body.decision==='approve'?'approved':'changes_requested';review.decision_note=body.note??null;data={status:review.status};window.dispatchEvent(new Event('admin-demo-update'));}
   else if(extraReviews.some(entry=>url.pathname.includes(entry.id))){const extra=extraReviews.find(entry=>url.pathname.includes(entry.id))!;const title=reviewTitles[extra.content_id]!;data={review:extra,snapshot:{revision_key:extra.revision_key,ownership_kind:'central',owner_branch_id:null,audience:{scope:'global'},dependencies:[]},reviewed_source:{document:{title,summary:{vi:`Bản gửi duyệt đầu tiên của ${title.vi}.`},body:{vi:{blocks:[{type:'paragraph',content:[{text:`Nội dung ${title.vi} dành cho học sinh THPT, gồm mục tiêu, hoạt động và tiêu chí đánh giá.`}]}]}}}},published_snapshot:null};}
   else data={review,snapshot:{revision_key:'v2',ownership_kind:'central',owner_branch_id:null,audience:{scope:'global'},dependencies:[]},reviewed_source:{document:{title:{vi:'Hướng dẫn học tập',en:'Learning guide'},summary:{vi:'Cách chuẩn bị bài và nộp bài đúng hạn.'},body:{vi:{blocks:[{type:'paragraph',content:[{text:'Học viên hoàn thành bài đọc trước buổi học và nộp bài vào thứ Sáu.'}]}]}}}},published_snapshot:{revision_key:'v1',source:{document:{title:{vi:'Hướng dẫn học tập'},summary:{vi:'Hướng dẫn cũ'},body:{vi:{blocks:[{type:'paragraph',content:[{text:'Nộp bài vào thứ Năm.'}]}]}}}}}};
 }
 else if(url.pathname.endsWith('/roles'))data=roles;
 else if(url.pathname.endsWith('/invitations')){if(init?.method==='POST'){data={id:'00000000-0000-4000-8000-000000000104',...body,status:'pending',createdAt:'2026-09-06T08:00:00Z',expiresAt:'2026-09-13T08:00:00Z',inviteUrl:'http://127.0.0.1:4176/invite/example'};invitations=[data,...invitations];}else data=invitations;}
 else if(/\/users\/[^/]+$/.test(url.pathname)){
   const user=members.find(member=>url.pathname.endsWith(member.id))!;
   if(init?.method==='PATCH'&&body.action==='identity')user.displayName=body.displayName;
   const global=active.kind==='central';data={...user,effectivePermissions:[],actions:{editIdentity:global,transfer:global,suspendAccount:global,manageMembership:true,assignRole:true,readLearning:true,readSubmissions:global,readHistory:true},learning:[{courseId:'python-foundations',courseVersionId:'v1',title:'Python cơ bản',status:'active',completedLessons:3,totalLessons:8,branchId:'ans'}],...(global?{submissions:[]}:{}),history:[]} satisfies MemberDetail;
 }
 else if(url.pathname.endsWith('/users')){const query=(url.searchParams.get('query')??'').toLowerCase();const pageNumber=Math.max(1,Number(url.searchParams.get('page'))||1);const pageSize=Number(url.searchParams.get('pageSize'))||20;const matching=members.filter(member=>(member.displayName.toLowerCase().includes(query)||member.email.includes(query))&&(url.searchParams.get('status')!=='suspended'||member.accountStatus==='suspended'));data={items:matching.slice((pageNumber-1)*pageSize,pageNumber*pageSize),page:pageNumber,pageSize,hasMore:matching.length>pageNumber*pageSize};}
 return new Response(JSON.stringify({data}),{status:200,headers:{'Content-Type':'application/json'}});
};
function App(){
 const pathname=usePathname();const [scope,setScope]=useState(active);const [,setRevision]=useState(0);
 useEffect(()=>{const update=()=>setRevision(value=>value+1);window.addEventListener('admin-demo-update',update);return()=>window.removeEventListener('admin-demo-update',update);},[]);
 useEffect(()=>{const update=()=>setScope(active);window.addEventListener('admin-demo-scope',update);return()=>window.removeEventListener('admin-demo-scope',update);},[]);
 const current=scopes.find(option=>scopeKey(option.scope)===scopeKey(scope))!;
 const shared={scope,actorId:'demo-operator',branches:[school]};
 const central=scope.kind==='central';
 const content=pathname==='/studio/reviews'?<section className="space-y-6"><StaffPageHeader title="Duyệt nội dung"/><ReviewQueue {...shared} rows={[review,...extraReviews]} canReview={central} canPublish={central} titles={manyReviews?Object.fromEntries([review,...extraReviews].map(entry=>[`${entry.content_type}:${entry.content_id}`,reviewTitles[entry.content_id]])):undefined} submitters={manyReviews?{}:undefined}/></section>
  :pathname==='/studio/library'?<section className="space-y-6"><ContentInventory {...shared} title="Thư viện nội dung" creatableTypes={['resource']} requestableKeys={libraryRows.map(row=>`${row.content_type}:${row.content_id}`)} rows={libraryRows}/></section>
  :pathname==='/admin/roles'?<RoleManager scope={scope}/>
  :pathname==='/admin/mcp'?<McpBlockView initialUserId={new URLSearchParams(location.search).get('userId')??''} actorId="demo-operator"/>
  :pathname==='/admin'?<Suspense fallback={null}><AdminOverviewFixture permissions={current.permissions} entries={entries} central={central}/></Suspense>
  :pathname==='/admin/branches'?<Suspense fallback={null}><BranchesFixture canManage={central}/></Suspense>
  :pathname.startsWith('/admin/branches/')?<Suspense fallback={null}><SchoolDetailFixture branchId={pathname.split('/').at(-1)!}/></Suspense>
  :pathname==='/admin/audit'?<Suspense fallback={null}><AuditFixture/></Suspense>
  :pathname.startsWith('/admin/users/')?<MemberProfile userId={pathname.split('/').at(-1)!} scope={scope} canManageMcpAccess={central}/>
  :<MembersDirectory scope={scope} stats={memberStats}/>;
 if(staffUi)return <NextIntlClientProvider locale="vi" messages={vi} timeZone={TIME_ZONE}><Suspense fallback={null}><StaffHarnessShell workspace={pathname.startsWith('/studio/')?'studio':'admin'} entries={entries} key={scopeKey(scope)} permissions={current.permissions} activeScope={scope} scopeOptions={scopes}>{content}</StaffHarnessShell></Suspense></NextIntlClientProvider>;
 const Shell=pathname.startsWith('/studio/')?StudioShell:AdminShell;
 return <NextIntlClientProvider locale="vi" messages={vi} timeZone={TIME_ZONE}><Shell redesigned={new URLSearchParams(location.search).has('redesigned')} entries={entries} key={scopeKey(scope)} permissions={current.permissions} activeScope={scope} scopeOptions={scopes} userName="Người quản trị thử nghiệm">{content}</Shell></NextIntlClientProvider>;
}
createRoot(document.getElementById('root')!).render(<App/>);
