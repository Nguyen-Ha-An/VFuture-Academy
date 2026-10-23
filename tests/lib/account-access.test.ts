import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const result=vi.hoisted(()=>({value:{data:{status:'active'} as {status:string}|null,error:null as unknown}}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>result.value})})})})}));
import { assertActiveAccount } from '@/lib/account-access';
beforeEach(()=>{result.value={data:{status:'active'},error:null};});
describe('protected account access',()=>{
 it('allows active accounts',async()=>{await expect(assertActiveAccount('member')).resolves.toBeUndefined();});
 it('denies suspended accounts even with a valid authentication token',async()=>{result.value.data={status:'suspended'};await expect(assertActiveAccount('member')).rejects.toMatchObject({status:403,code:'ACCOUNT_SUSPENDED'});});
 it('fails closed on missing status or database failure',async()=>{result.value.data=null;await expect(assertActiveAccount('member')).rejects.toThrow('verify account');result.value.error={secret:'hidden'};await expect(assertActiveAccount('member')).rejects.toThrow('verify account');});
});
