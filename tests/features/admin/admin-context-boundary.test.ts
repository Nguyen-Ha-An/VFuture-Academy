import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {assertRequestScope,assertSameOrigin,type AdminContext} from '@/features/admin/context';
const context: AdminContext={workspace:'admin',actor:{userId:'admin-a',roles:[]},scope:{kind:'branch',branchId:'ans'},options:[],permissions:[],branches:[],entries:{studio:null,grading:null,admin:'/admin'}};
describe('management request intent boundary',()=>{
 it('rejects an earlier account or scope before data access',()=>{
  expect(()=>assertRequestScope(context,new Request('http://localhost/api/v1/admin/users?scope=branch%3Aans&actorId=admin-a'))).not.toThrow();
  expect(()=>assertRequestScope(context,new Request('http://localhost/api/v1/admin/users?scope=branch%3Adewey'))).toThrow('active management scope changed');
  expect(()=>assertRequestScope(context,new Request('http://localhost/api/v1/admin/users?actorId=admin-b'))).toThrow('signed-in account changed');
 });
 it('rejects cross-site mutation origins',()=>{
  expect(()=>assertSameOrigin(new Request('https://academy.example/api/v1/admin/users',{headers:{origin:'https://evil.example'}}))).toThrow('Cross-origin');
  expect(()=>assertSameOrigin(new Request('https://academy.example/api/v1/admin/users',{headers:{origin:'https://academy.example'}}))).not.toThrow();
 });
});
