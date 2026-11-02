import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createCustomerGraph, CUSTOMER_TENANT } from '@/lib/identity/admin-graph';
import { AccountMutationSchema, runAccountOperation, type AccountOperation } from '@/lib/identity/admin-accounts';
const target='10000000-0000-4000-8000-000000000001';
const operation: AccountOperation={id:target,userId:target,action:'disable',payload:{},subject:target,status:'pending'};

describe('Azure account lifecycle',()=>{
  it('rejects caller-supplied provider targets, credentials, and unconfirmed deletes',()=>{
    for(const extra of [{subject:target},{issuer:'https://other'},{password:'secret'},{tenantId:CUSTOMER_TENANT}])expect(AccountMutationSchema.safeParse({action:'disable',operationId:target,...extra}).success).toBe(false);
    expect(AccountMutationSchema.safeParse({action:'delete',operationId:target,confirmation:'yes'}).success).toBe(false);
  });
  it('persists the local block before calling Graph and leaves it blocked on remote failure',async()=>{
    const events:string[]=[];
    const store={begin:async()=>{events.push('blocked');return operation;},record:async()=>{},complete:async()=>{events.push('complete');return {};},fail:async()=>{events.push('failed');}};
    const graph={assertCustomer:async()=>{events.push('checked');return true;},revoke:async()=>{events.push('revoke');throw new Error('remote');},setEnabled:async()=>{events.push('disable');},remove:async()=>{},update:async()=>{},create:async()=>target};
    await expect(runAccountOperation(store,graph,{} as never)).rejects.toThrow('retry');
    expect(events).toEqual(['blocked','checked','revoke','failed']);
  });
  it('revokes before deleting and never sends an Academy ID as a Graph target',async()=>{
    const events:string[]=[];const subject='20000000-0000-4000-8000-000000000002';
    const store={begin:async()=>({...operation,action:'delete' as const,subject}),record:async()=>{},complete:async()=>{events.push('complete');return {};},fail:async()=>{}};
    const graph={assertCustomer:async(id:string)=>{expect(id).toBe(subject);return true;},revoke:async(id:string)=>{expect(id).toBe(subject);events.push('revoke');},remove:async(id:string)=>{expect(id).toBe(subject);events.push('delete');},setEnabled:async()=>{},update:async()=>{},create:async()=>subject};
    await runAccountOperation(store,graph,{} as never);expect(events).toEqual(['revoke','delete','complete']);
  });
  it('refuses to enable a creation-recovery identity that became a directory administrator',async()=>{
    const events:string[]=[];
    const store={begin:async()=>({...operation,action:'create' as const,payload:{email:'a@example.com',displayName:'A'}}),record:async()=>{events.push('mapped');},complete:async()=>{events.push('complete');return {};},fail:async()=>{events.push('failed');}};
    const graph={assertCustomer:async()=>{throw new Error('Directory administrator');},revoke:async()=>{},remove:async()=>{},setEnabled:async()=>{events.push('enabled');},update:async()=>{},create:async()=>target};
    await expect(runAccountOperation(store,graph,{} as never)).rejects.toThrow('retry');
    expect(events).toEqual(['mapped','failed']);
  });
  it('rejects non-customer Graph users before remote mutation',async()=>{
    const request=vi.fn(async(url: string | URL | Request)=>new Response(JSON.stringify(String(url).includes('token')?{access_token:'token'}:{id:target,creationType:null,identities:[{signInType:'userPrincipalName'}]}),{status:200}));
    const graph=createCustomerGraph({ENTRA_TENANT_ID:CUSTOMER_TENANT,ENTRA_ADMIN_CLIENT_ID:target,ENTRA_ADMIN_CLIENT_SECRET:'secret'},request);
    await expect(graph.assertCustomer(target)).rejects.toThrow('customer');expect(request).toHaveBeenCalledTimes(2);
  });
  it('pins admin credentials to the customer tenant and never uses workforce credentials',()=>{
    expect(()=>createCustomerGraph({ENTRA_TENANT_ID:'157419c9-2de9-45e7-a6f9-91546dbef629',ENTRA_ADMIN_CLIENT_ID:target,ENTRA_ADMIN_CLIENT_SECRET:'secret'})).toThrow();
    expect(()=>createCustomerGraph({ENTRA_TENANT_ID:CUSTOMER_TENANT,ENTRA_CLIENT_ID:target,ENTRA_CLIENT_SECRET:'secret'})).toThrow();
  });
  it('posts a disabled local email account with password reset onboarding and no forced sign-in change',async()=>{
    const posted:Record<string,unknown>[]=[];
    const request=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{
      if(String(url).includes('/oauth2/v2.0/token'))return new Response(JSON.stringify({access_token:'token'}),{status:200});
      if(init?.method==='GET')return new Response(JSON.stringify({error:{code:'Request_ResourceNotFound'}}),{status:404});
      expect(String(url)).toBe('https://graph.microsoft.com/v1.0/users');
      expect(init?.method).toBe('POST');
      posted.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({id:target}),{status:201});
    });
    const graph=createCustomerGraph({ENTRA_TENANT_ID:CUSTOMER_TENANT,ENTRA_ADMIN_CLIENT_ID:target,ENTRA_ADMIN_CLIENT_SECRET:'secret'},request);
    const result=await graph.create(target,{email:'a@example.com',displayName:'A'});
    expect(result).toBe(target);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({accountEnabled:false,displayName:'A',userPrincipalName:`academy-${target}@vfutureacademy.onmicrosoft.com`,identities:[{signInType:'emailAddress',issuer:'vfutureacademy.onmicrosoft.com',issuerAssignedId:'a@example.com'}],passwordPolicies:'DisablePasswordExpiration',passwordProfile:{forceChangePasswordNextSignIn:false}});
    const profile=posted[0].passwordProfile as {password:string};
    expect(profile.password.length).toBeGreaterThanOrEqual(40);
    expect(result).not.toContain(profile.password);
  });
  it('reuses deterministic creation identity after an ambiguous Graph create response',async()=>{
    const seen:string[]=[];
    const request=vi.fn(async(url: string | URL | Request,init?:RequestInit)=>{seen.push(`${init?.method??'GET'} ${url}`);return new Response(JSON.stringify(String(url).includes('token')?{access_token:'token'}:{id:target,userPrincipalName:`academy-${target}@vfutureacademy.onmicrosoft.com`,mailNickname:`academy-${target}`,identities:[{signInType:'emailAddress',issuer:'vfutureacademy.onmicrosoft.com',issuerAssignedId:'a@example.com'}]}),{status:200});});
    const graph=createCustomerGraph({ENTRA_TENANT_ID:CUSTOMER_TENANT,ENTRA_ADMIN_CLIENT_ID:target,ENTRA_ADMIN_CLIENT_SECRET:'secret'},request);
    expect(await graph.create(target,{email:'a@example.com',displayName:'A'})).toBe(target);
    expect(seen.some(s=>s.startsWith('POST https://graph'))).toBe(false);
  });
});
