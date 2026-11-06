import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/lib/authorization';
const state=vi.hoisted(()=>({actor:null as Actor|null, require:vi.fn(), read:vi.fn(), replace:vi.fn(), options:vi.fn(), assigned:vi.fn()}));
vi.mock('@/lib/permissions',()=>({getActor:async()=>state.actor,requirePermission:state.require}));
vi.mock('@/features/teaching/assignments',()=>({getCourseTeachers:state.read,replaceCourseTeachers:state.replace,teacherOptions:state.options,assignedCourses:state.assigned}));
import { GET, PUT } from '@/app/api/v1/teaching/courses/[courseId]/teachers/route';
import { GET as OPTIONS } from '@/app/api/v1/teaching/teacher-options/route';
import { GET as ASSIGNED } from '@/app/api/v1/teaching/assigned-courses/route';
const actor:Actor={userId:'98000000-0000-4000-8000-000000000002',roles:[]};
const context={params:Promise.resolve({courseId:'course'})};
beforeEach(()=>{
  vi.clearAllMocks();state.actor=actor;state.require.mockResolvedValue(actor);
  state.read.mockResolvedValue({courseId:'course',branchId:'historical',revision:0,teachers:[]});
  state.replace.mockResolvedValue({courseId:'course',branchId:'a',revision:1,teachers:[]});
  state.options.mockResolvedValue({teachers:[],hasMore:false,page:1,pageSize:100});
  state.assigned.mockResolvedValue({courses:[]});
});
describe('teacher assignment API boundaries',()=>{
  it('requires signed-in actors for teacher reads',async()=>{
    state.actor=null;
    expect((await GET(new Request('https://academy.test/api/v1/teaching/courses/course/teachers'),context)).status).toBe(401);
    expect(state.read).not.toHaveBeenCalled();
  });
  it('uses historical enrollment resolver when learner omits branch',async()=>{
    const result=await GET(new Request('https://academy.test/api/v1/teaching/courses/course/teachers'),context);
    expect(result.status).toBe(200);expect(state.read).toHaveBeenCalledWith(actor,'course',undefined);
    expect(await result.json()).toEqual({data:{courseId:'course',branchId:'historical',revision:0,teachers:[]}});
  });
  it('requires revision and rejects contradictory branch before write',async()=>{
    for(const input of [{branchId:'a',teachers:[]},{branchId:'a',expectedRevision:0,teachers:[]}]){
      const request=new Request('https://academy.test/api/v1/teaching/courses/course/teachers?branchId=b',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
      expect((await PUT(request,context)).status).toBe(400);
    }
    expect(state.replace).not.toHaveBeenCalled();
  });
  it('authorizes manage capability at replacement body branch',async()=>{
    const input={branchId:'a',expectedRevision:2,teachers:[]};
    const response=await PUT(new Request('https://academy.test/api/v1/teaching/courses/course/teachers',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(input)}),context);
    expect(response.status).toBe(200);
    expect(state.require).toHaveBeenCalledWith('teaching.assignment.manage',{branchId:'a'});
    expect(state.replace).toHaveBeenCalledWith(actor,'course',input);
  });
  it('rejects cross-site writes through shared handler',async()=>{
    const response=await PUT(new Request('https://academy.test/api/v1/teaching/courses/course/teachers',{method:'PUT',headers:{origin:'https://other.test'},body:'{}'}),context);
    expect(response.status).toBe(403);expect(state.replace).not.toHaveBeenCalled();
  });
  it('bounds candidate pagination and requires manage capability',async()=>{
    expect((await OPTIONS(new Request('https://academy.test/api/v1/teaching/teacher-options?branchId=a&page=2&pageSize=25'))).status).toBe(200);
    expect(state.options).toHaveBeenCalledWith(actor,'a',2,25);
    expect((await OPTIONS(new Request('https://academy.test/api/v1/teaching/teacher-options?branchId=a&pageSize=1000'))).status).toBe(400);
  });
  it('returns empty assigned courses to ordinary signed-in learners and forwards locale',async()=>{
    const response=await ASSIGNED(new Request('https://academy.test/api/v1/teaching/assigned-courses?locale=en'));
    expect(response.status).toBe(200);expect(await response.json()).toEqual({data:{courses:[]}});
    expect(state.assigned).toHaveBeenCalledWith(actor,'en');
  });
});
