import { describe, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({rows:{} as Record<string,unknown[]>}));
vi.mock('server-only',()=>({}));
vi.mock('@/features/teaching/assignments',()=>({teachingCourseScope:async()=>({all:true,branchIds:[],assignments:[]}),assertCourseTeaching:async()=>{}}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:()=>({from:(table:string)=>{
  const filters: Array<(row:Record<string,unknown>)=>boolean>=[];
  const query={select:()=>query,eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return query;},in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return query;},then:(resolve:(value:unknown)=>unknown)=>resolve({data:(fixture.rows[table] ?? []).filter(row=>filters.every(filter=>filter(row as Record<string,unknown>))),error:null})};
  return query;
}})}));
import { teachingOptions } from '@/features/teaching/service';
describe('school course options',()=>{
  it('includes school-pinned archived versions but excludes other schools and unavailable current versions',async()=>{
    fixture.rows={
      courses:[{id:'archived',status:'archived',current_version_id:'v1',ownership_kind:'central'},{id:'shared',status:'published',current_version_id:'v2',ownership_kind:'central'},{id:'restricted',status:'published',current_version_id:'v3',ownership_kind:'central'},{id:'foreign',status:'published',current_version_id:'v4',ownership_kind:'branch',owner_branch_id:'other'}],
      enrollments:[{course_id:'archived',course_version_id:'v1',branch_id:'school',branch_scope_known:true,status:'active'},{course_id:'restricted',course_version_id:'v3',branch_id:'other',branch_scope_known:true,status:'active'}],
      course_versions:[{id:'v1',course_id:'archived',version:1},{id:'v2',course_id:'shared',version:2},{id:'v3',course_id:'restricted',version:3},{id:'v4',course_id:'foreign',version:1}],
      course_version_outline:[{version_id:'v1',access:{scope:'branches',branchIds:['other']},meta:{title:{en:'Old'}}},{version_id:'v2',access:{scope:'global'},meta:{title:{en:'Shared'}}},{version_id:'v3',access:{scope:'branches',branchIds:['other']},meta:{}},{version_id:'v4',access:{scope:'global'},meta:{}}],
    };
    const options=await teachingOptions({userId:'teacher',roles:[]},'school');
    expect(options.versions.map(row=>row.courseVersionId)).toEqual(['v1','v2']);
    expect(options.courses).toEqual([{id:'archived',title:'Old'},{id:'shared',title:'Shared'}]);
  });
});
