'use client';

import { useEffect, useId, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { scopeKey, type AdminScope } from '@/lib/admin-scope';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import type { StudioLearningReport } from '../contracts';
import { reportCopy } from './messages';
import { ReportPanels } from './ReportPanels';

export type ReportFilters = {from:string;to:string;branchId:string;courseId:string;publication:string};
function defaultDates() {
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const start=new Date(`${today}T00:00:00Z`);start.setUTCDate(start.getUTCDate()-29);
  return {from:start.toISOString().slice(0,10),to:today};
}
export function LearningReports({actorId,scope,branches,initialFilters={},canGrade=false}: {actorId:string;scope:AdminScope;branches:Array<{id:string;name:string}>;initialFilters?:Partial<ReportFilters>;canGrade?:boolean}) {
  const locale=useLocale();const t=locale==='en'?reportCopy.en:reportCopy.vi;const id=useId();
  const [filters,setFilters]=useState<ReportFilters>(()=>({...defaultDates(),courseId:'',publication:'released',...initialFilters,branchId:scope.kind==='branch'?scope.branchId:initialFilters.branchId??''}));
  const [applied,setApplied]=useState(filters);const [tab,setTab]=useState(0);const [retry,setRetry]=useState(0);
  const [courseOptions,setCourseOptions]=useState<Array<{courseId:string;title:string|null}>>([]);
  const [data,setData]=useState<StudioLearningReport|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(false);setData(null);
    const query=new URLSearchParams({from:applied.from,to:applied.to,scope:scopeKey(scope),actorId,publication:applied.publication});
    if(applied.branchId)query.set('branchId',applied.branchId);if(applied.courseId)query.set('courseId',applied.courseId);
    fetch(`/api/v1/studio/reports?${query}`,{signal:controller.signal}).then(async response=>{
      const result=await response.json();if(!response.ok||!result.data)throw new Error('report_failed');
      if(!controller.signal.aborted){setData(result.data);if(!applied.courseId)setCourseOptions(result.data.courses);}
    }).catch(()=>{if(!controller.signal.aborted)setError(true)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return ()=>controller.abort();
  },[applied,actorId,scope,retry]);
  const field=(key:keyof ReportFilters,value:string)=>setFilters(previous=>({...previous,[key]:value}));
  const fieldClass='grid gap-2 text-sm font-medium leading-normal';
  return <section className="space-y-6" aria-label={t.title}>
    <StaffPageHeader eyebrow={t.eyebrow} title={t.title} description={t.description}/>
    <form onSubmit={event=>{event.preventDefault();if(filters.from<=filters.to)setApplied({...filters})}} className="rounded-lg border border-border bg-card p-6 text-card-foreground">
      <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <label className={fieldClass}>{t.branch}<NativeSelect wrapperClassName="w-full" value={filters.branchId} disabled={scope.kind==='branch'} onChange={e=>field('branchId',e.target.value)}>{scope.kind==='central'&&<NativeSelectOption value="">{t.allBranches}</NativeSelectOption>}{branches.map(b=><NativeSelectOption value={b.id} key={b.id}>{b.name}</NativeSelectOption>)}</NativeSelect></label>
        <label className={fieldClass}>{t.course}<NativeSelect wrapperClassName="w-full" value={filters.courseId} onChange={e=>field('courseId',e.target.value)}><NativeSelectOption value="">{t.allCourses}</NativeSelectOption>{courseOptions.map(c=><NativeSelectOption key={c.courseId} value={c.courseId}>{c.title||c.courseId}</NativeSelectOption>)}</NativeSelect></label>
        <label className={fieldClass}>{t.from}<Input required type="date" className="tabular-nums" value={filters.from} max={filters.to} onChange={e=>field('from',e.target.value)}/></label>
        <label className={fieldClass}>{t.to}<Input required type="date" className="tabular-nums" value={filters.to} min={filters.from} onChange={e=>field('to',e.target.value)}/></label>
        <label className={fieldClass}>{t.publication}<NativeSelect wrapperClassName="w-full" value={filters.publication} onChange={e=>field('publication',e.target.value)}><NativeSelectOption value="released">{t.released}</NativeSelectOption><NativeSelectOption value="unreleased">{t.unreleased}</NativeSelectOption><NativeSelectOption value="all">{t.allResults}</NativeSelectOption></NativeSelect></label>
        <Button type="submit" disabled={loading||filters.from>filters.to}>{t.apply}</Button>
      </div><p className="mt-4 text-xs leading-normal text-muted-foreground">{t.datesHint}</p>
    </form>
    <div role="tablist" aria-label={t.title} className="flex gap-1 overflow-x-auto border-b border-border">{t.tabs.map((title,index)=><button key={title} role="tab" type="button" id={`${id}-tab-${index}`} aria-selected={tab===index} aria-controls={`${id}-panel`} tabIndex={tab===index?0:-1} onClick={()=>setTab(index)} onKeyDown={event=>{const next=event.key==='ArrowRight'?(index+1)%4:event.key==='ArrowLeft'?(index+3)%4:event.key==='Home'?0:event.key==='End'?3:null;if(next!==null){event.preventDefault();setTab(next);document.getElementById(`${id}-tab-${next}`)?.focus()}}} className={`-mb-px min-h-10 shrink-0 border-b-2 px-4 text-sm font-medium leading-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${tab===index?'border-primary text-foreground':'border-transparent text-muted-foreground hover:text-foreground'}`}>{title}</button>)}</div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} aria-busy={loading}>
      {loading?<p role="status" className="py-10 text-sm leading-normal text-muted-foreground">{t.loading}</p>:error?<div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm leading-normal text-destructive-soft-foreground"><p>{t.error}</p><Button variant="outline" className="mt-3" onClick={()=>setRetry(value=>value+1)}>{t.retry}</Button></div>:data?<><p className="mb-4 text-xs leading-normal text-muted-foreground tabular-nums">{data.period.from} — {data.period.to} · {data.period.timezone} · {applied.publication==='released'?t.released:applied.publication==='unreleased'?t.unreleased:t.allResults}</p>{data.visibility.unknownHistoricalBranch&&<p className="mb-4 rounded-md bg-muted p-3 text-sm leading-normal">{t.unknown}</p>}<ReportPanels canGrade={canGrade} data={data} tab={tab} copy={t} locale={locale}/></>:null}
    </div>
  </section>;
}
