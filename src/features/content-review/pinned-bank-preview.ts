import 'server-only';
import { ApiError } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';

/** Called only after the review RPC has authorized access to this immutable snapshot. */
export async function pinnedBankPreview(preview: unknown) {
  if(!preview||typeof preview!=='object'||Array.isArray(preview))return preview;
  const value=preview as Record<string,unknown>;
  const snapshot=value.snapshot as {dependencies?: unknown[]}|undefined;
  const dependencies=(snapshot?.dependencies??[]).flatMap(dep=>{
    if(!dep||typeof dep!=='object')return [];
    const d=dep as Record<string,unknown>;
    return d.kind==='bank_version'&&typeof d.id==='string'&&typeof d.revision_key==='string'?[{id:d.id,version:d.revision_key}]:[];
  });
  if(!dependencies.length)return value;
  const {data,error}=await supabaseService().from('bank_question_versions').select('id,question_id,payload').in('id',dependencies.map(d=>d.version));
  if(error)throw new ApiError(500,'REVIEW_DEPENDENCY_ERROR','Unable to load pinned questions');
  const resolvedBankQuestions:Record<string,unknown>={};
  for(const dep of dependencies){const row=data?.find(row=>row.id===dep.version&&row.question_id===dep.id);if(row)resolvedBankQuestions[dep.id]=row.payload;}
  return {...value,resolvedBankQuestions};
}
