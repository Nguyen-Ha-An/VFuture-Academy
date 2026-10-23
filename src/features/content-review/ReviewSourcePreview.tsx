'use client';
/* Private authenticated media URLs use the browser session; Next image optimization cannot proxy that session. */
/* eslint-disable @next/next/no-img-element */
import { useMemo } from 'react';
import { localizeDeep } from '@/content-engine/compile/localize';
import { QuestionRenderer } from '@/content-engine/render/QuestionRenderer';
import { BlockList } from '@/content-engine/render/BlockList';
import { registerAllQuestions } from '@/content-engine/render/questions';
import { registerAllBlocks } from '@/content-engine/render/blocks';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import type { LearnerQuestion } from '@/content-engine/render/registry';
import type { LessonBlock } from '@/content-engine/schema/types';

registerAllBlocks();
registerAllQuestions();
const object = (v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const label = (v:unknown)=>typeof v==='string'?v:'';
const records = (v:unknown)=>Array.isArray(v)?v.flatMap(x=>object(x)?[object(x)!]:[]):[];
function runtimeFor(locale:'vi'|'en'):LessonRuntime {
  const unavailable=async()=>{throw new Error('Read-only review preview')};
  return {mode:'preview',locale,getBlockState:()=>undefined,setBlockState:()=>{},submitQuiz:unavailable,checkQuestion:unavailable,getAssignmentSession:()=>undefined,refreshAssignmentSession:unavailable,submitAssignment:unavailable,uploadAssignmentFile:unavailable,uploadFile:unavailable,resolveMedia:ref=>'url' in ref?ref.url:`/api/v1/media/${encodeURIComponent(ref.assetId)}`,hrefFor:()=> '#',markViewed:()=>{},onActivityComplete:()=>{}} as LessonRuntime;
}
function Content({value,runtime,path}:{value:unknown;runtime:LessonRuntime;path:string}) {
  const doc=object(value);
  if(typeof value==='string')return <p className="whitespace-pre-wrap leading-7">{value}</p>;
  if(!doc)return null;
  if(Array.isArray(doc.blocks))return <BlockList blocks={doc.blocks as LessonBlock[]} runtime={runtime} path={path} depth={0}/>;
  return null;
}
function Question({value,runtime,index}:{value:Record<string,unknown>;runtime:LessonRuntime;index:number}) {
  const pool=object(value.$pool);
  if(pool)return <div className="rounded-md border border-dashed border-primary/50 p-4 text-sm"><p>{runtime.locale==='vi'?'Rút từ ngân hàng câu hỏi':'Draw from question bank'}: {String(pool.id??'')} · {String(pool.count??'')} {runtime.locale==='vi'?'câu':'questions'}</p>{Array.isArray(pool.from)&&<p className="mt-2 text-muted-foreground">{pool.from.join(', ')}</p>}</div>;
  if(typeof value.$ref==='string')return <div className="rounded-md border border-border p-3 text-sm">{runtime.locale==='vi'?'Câu hỏi tham chiếu đã ghim':'Pinned question reference'}: {value.$ref}</div>;
  if(!value.type||!value.content)return null;
  return <QuestionRenderer question={value as LearnerQuestion} index={index} value={undefined} onChange={()=>{}} disabled runtime={runtime}/>;
}
function Document({doc,runtime,path}:{doc:Record<string,unknown>;runtime:LessonRuntime;path:string}) {
  const body=object(doc.assignment)??doc;
  const notebook=object(body.notebook);
  return <article id={path} className="scroll-mt-20 space-y-4 rounded-lg border border-border bg-card p-5">
    {doc.title?<h3 className="text-xl font-semibold">{label(doc.title)}</h3>:null}
    <Content value={doc.summary??doc.description} runtime={runtime} path={`${path}/description`}/>
    {Array.isArray(doc.blocks)?<Content value={doc} runtime={runtime} path={`${path}/blocks`}/>:null}
    {doc.kind==='assignment'||body.instructions?<Content value={body.instructions} runtime={runtime} path={`${path}/instructions`}/>:null}
    {notebook?<div className="rounded-md border border-border bg-muted/30 p-4 text-sm"><h4 className="font-semibold">{runtime.locale==='vi'?'Sổ tay':'Notebook'}</h4><p className="mt-1">{runtime.locale==='vi'?'Cấu hình sổ tay và bộ dữ liệu được ghim trong mục Tài nguyên & tích hợp. Không khởi chạy phiên học khi duyệt.':'Notebook and dataset configuration is pinned in Resources & integrations. Reviewing does not launch a learning session.'}</p></div>:null}
    {records(doc.sections).map((section,si)=><section key={label(section.id)||si} className="space-y-4 border-t border-border pt-4"><h4 className="font-semibold">{label(section.title)}</h4><Content value={section.instructions} runtime={runtime} path={`${path}/section-${si}`}/>{records(section.questions).map((q,qi)=><Question key={label(q.id)||qi} value={q} runtime={runtime} index={qi}/>)}</section>)}
    {doc.type&&doc.content?<Question value={doc} runtime={runtime} index={0}/>:null}
    {body.instructions||doc.blocks||doc.sections||doc.content?null:<Content value={doc.body} runtime={runtime} path={`${path}/body`}/>}
    {typeof doc.url==='string'&&/^https?:\/\//i.test(doc.url)?<a className="inline-flex min-h-10 items-center text-primary underline" href={doc.url} target="_blank" rel="noopener noreferrer">{doc.url}</a>:null}
  </article>;
}
function resolveRefs(value:unknown,questions:Record<string,unknown>,depth=0):unknown {
  if(depth>32)return value;
  if(Array.isArray(value))return value.map(v=>resolveRefs(v,questions,depth+1));
  const node=object(value);if(!node)return value;
  if(typeof node.$ref==='string'&&node.$ref.startsWith('bank:'))return questions[node.$ref.slice(5)]??node;
  return Object.fromEntries(Object.entries(node).map(([k,v])=>[k,resolveRefs(v,questions,depth+1)]));
}
export function ReviewSourcePreview({source,locale,resolvedBankQuestions={}}:{source:unknown;locale:string;resolvedBankQuestions?:Record<string,unknown>}) {
  const language=locale==='en'?'en':'vi';
  const runtime=useMemo(()=>runtimeFor(language),[language]);
  const raw=object(source)??{};
  const defaultLanguage=object(raw.manifest)?.defaultLanguage==='en'?'en':'vi';
  const localized=object(localizeDeep(resolveRefs(source,resolvedBankQuestions),language,defaultLanguage))??{};
  const manifest=object(localized.manifest);
  const items=object(localized.items);
  const asset=object(localized.asset);
  const documents=items?Object.entries(items).flatMap(([id,v])=>object(v)?[{id,doc:object(v)!}]:[]):[{id:'document',doc:object(localized.document)??object(localized.record)??object(object(localized.version)?.payload)??localized}];
  if(asset&&typeof asset.id==='string'){
    const url=`/api/v1/media/${encodeURIComponent(asset.id)}`;const mime=label(asset.mime);
    return <div className="space-y-3">{mime.startsWith('image/')?<img className="max-h-[32rem] max-w-full rounded-lg object-contain" src={url} alt={label(asset.alt)}/>:mime.startsWith('video/')?<video className="max-h-[32rem] w-full" src={url} controls/>:mime.startsWith('audio/')?<audio src={url} controls/>:<a className="text-primary underline" href={url} target="_blank" rel="noopener noreferrer">{label(asset.path).split('/').at(-1)||asset.id}</a>}<p className="text-sm text-muted-foreground">{mime} · {String(asset.size_bytes??0)} bytes</p></div>;
  }
  return <div className={items?'grid gap-5 lg:grid-cols-[12rem_minmax(0,1fr)]':'space-y-4'}>
    {items?<nav aria-label={language==='vi'?'Nội dung bản duyệt':'Review content'} className="space-y-1 lg:sticky lg:top-20 lg:self-start"><h3 className="mb-3 font-semibold">{label(manifest?.title)}</h3>{documents.map(({id,doc})=><a key={id} href={`#review-item-${id}`} className="block rounded-md px-3 py-2 text-sm hover:bg-muted">{label(doc.title)||id}</a>)}</nav>:null}
    <fieldset disabled className="min-w-0 space-y-5">{documents.map(({id,doc})=><Document key={id} doc={doc} runtime={runtime} path={`review-item-${id}`}/>)}</fieldset>
  </div>;
}
