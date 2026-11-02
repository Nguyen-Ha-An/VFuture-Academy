import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { createAzureDataClient } from '@/lib/database/azure-client';
import { can } from '@/lib/permissions';
import type { AdminContext } from '@/features/admin/context';
import { academyBackend } from './provider';
import { adminAccountsConfigured, createCustomerGraph } from './admin-graph';

const operationId=z.string().uuid();
export const AccountMutationSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),operationId,email:z.string().trim().email().max(254).transform(s=>s.toLowerCase()),displayName:z.string().trim().min(1).max(160)}).strict(),
  z.object({action:z.literal('edit'),operationId,displayName:z.string().trim().min(1).max(160)}).strict(),
  z.object({action:z.enum(['disable','enable']),operationId}).strict(),
  z.object({action:z.literal('delete'),operationId,confirmation:z.literal('DELETE LOGIN')}).strict(),
  z.object({action:z.literal('retry'),operationId}).strict(),
]);
export type AccountMutation=z.infer<typeof AccountMutationSchema>;
export type AccountOperation={id:string;userId:string;action:'create'|'edit'|'disable'|'enable'|'delete';payload:Record<string,string>;subject:string|null;status:'pending'|'complete'};
export type AccountState={userId:string;status:'active'|'disabled'|'deleted';operation:AccountOperation|null};
type OperationInput={context:AdminContext;userId:string|null;mutation:AccountMutation;lease:string};
interface OperationStore{
  begin(input:OperationInput):Promise<AccountOperation>;
  record(input:OperationInput,subject:string):Promise<void>;
  complete(input:OperationInput):Promise<unknown>;
  fail(input:OperationInput):Promise<void>;
}
type Graph=ReturnType<typeof createCustomerGraph>;
/** Durable local suspension precedes Graph. Retries use the same journal and immutable mapping. */
export async function runAccountOperation(store:OperationStore,graph:Graph,input:OperationInput){
  const operation=await store.begin(input);
  if(operation.status==='complete')return store.complete(input);
  try{
    let subject=operation.subject;
    if(operation.action==='create'){
      subject=subject??await graph.create(operation.id,{email:operation.payload.email,displayName:operation.payload.displayName});
      await store.record(input,subject);
      if(!await graph.assertCustomer(subject))throw new Error('Customer identity missing');
      await graph.setEnabled(subject,true);
    }else if(subject){
      const exists=await graph.assertCustomer(subject);
      if(!exists&&operation.action!=='delete')throw new Error('Customer identity missing');
      if(exists){
        if(operation.action==='disable'||operation.action==='delete')await graph.revoke(subject);
        if(operation.action==='delete')await graph.remove(subject);
        else if(operation.action==='disable'||operation.action==='enable')await graph.setEnabled(subject,operation.action==='enable');
        else await graph.update(subject,operation.payload.displayName);
      }
    }
    return await store.complete(input);
  }catch{
    await store.fail(input);
    throw new ApiError(503,'ACCOUNT_RETRY_REQUIRED','Account change is pending. Use retry to safely resume the same operation.');
  }
}
export function assertAccountAdmin(context:AdminContext){
  if(context.scope.kind!=='central'||!can(context.actor,'member.manage',{kind:'central'})||!can(context.actor,'admin.access',{kind:'central'}))throw new ApiError(403,'FORBIDDEN','Central member management permission required');
  if(academyBackend()!=='azure'||!adminAccountsConfigured())throw new ApiError(503,'ACCOUNT_ADMIN_UNAVAILABLE','Azure account administration is not configured');
}
async function call<T>(context:AdminContext,phase:string,input:Record<string,unknown>):Promise<T>{
  const {data,error}=await createAzureDataClient('service_role').rpc('academy_admin_account',{p_actor_id:context.actor.userId,p_phase:phase,p_input:input}).abortSignal(AbortSignal.timeout(10_000));
  if(error){
    if(error.code==='42501')throw new ApiError(403,'FORBIDDEN','Account operation denied');
    if(error.code==='P0002')throw new ApiError(404,'NOT_FOUND','Account not found');
    if(['23514','23505','40001','22023'].includes(error.code??''))throw new ApiError(409,'ACCOUNT_CONFLICT','Account cannot be changed: protect your own or final admin account, or resume its pending operation.');
    throw new Error('Account operation storage unavailable');
  }
  return data as T;
}
export async function readAccountState(context:AdminContext,userId:string):Promise<AccountState>{assertAccountAdmin(context);return call(context,'read',{userId});}
export async function mutateAccount(context:AdminContext,userId:string|null,mutation:AccountMutation){
  assertAccountAdmin(context);
  if(userId)z.string().uuid().parse(userId);
  if((mutation.action==='create')!==(userId===null)&&mutation.action!=='retry')throw new ApiError(400,'INVALID_OPERATION','Invalid account target');
  if(userId===context.actor.userId&&['disable','delete'].includes(mutation.action))throw new ApiError(409,'SELF_PROTECTED','You cannot disable or delete your own account');
  const input={context,userId,mutation,lease:randomUUID()};
  const args=(value:OperationInput)=>({userId:value.userId,...value.mutation,lease:value.lease});
  const store:OperationStore={begin:value=>call(context,'begin',args(value)),record:async(value,subject)=>{await call(context,'record',{...args(value),subject});},complete:value=>call(context,'complete',args(value)),fail:async value=>{await call(context,'fail',args(value));}};
  return runAccountOperation(store,createCustomerGraph(),input);
}
