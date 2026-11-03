import 'server-only';
import { randomBytes } from 'node:crypto';

export const CUSTOMER_TENANT = 'f3152aa5-61de-40fd-bb76-780b9fbe5428';
export const CUSTOMER_ISSUER = `https://${CUSTOMER_TENANT}.ciamlogin.com/${CUSTOMER_TENANT}/v2.0`;
const DOMAIN = 'vfutureacademy.onmicrosoft.com';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Environment = Readonly<Record<string,string|undefined>>;
type Customer = {id:string; creationType?:string; userPrincipalName?:string;mailNickname?:string;identities?:{signInType:string;issuer:string;issuerAssignedId:string}[]};
export function adminAccountsConfigured(env: Environment = process.env) {
  return env.ENTRA_TENANT_ID === CUSTOMER_TENANT && uuid.test(env.ENTRA_ADMIN_CLIENT_ID??'') && Boolean(env.ENTRA_ADMIN_CLIENT_SECRET);
}
/** A separate app in the pinned customer tenant; never reuse workforce/web credentials. */
export function createCustomerGraph(env:Environment=process.env, request:typeof fetch=fetch) {
  if(!adminAccountsConfigured(env)) throw new Error('Customer account administration is not configured');
  let token: string | undefined;
  async function call<T>(path:string,method='GET',body?:unknown,allowMissing=false):Promise<T|null>{
    if(!token){
      const response=await request(`https://login.microsoftonline.com/${CUSTOMER_TENANT}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.ENTRA_ADMIN_CLIENT_ID!,client_secret:env.ENTRA_ADMIN_CLIENT_SECRET!,scope:'https://graph.microsoft.com/.default'}),signal:AbortSignal.timeout(10_000),redirect:'error'});
      if(!response.ok)throw new Error('Customer directory authorization unavailable');
      const data=await response.json();if(typeof data.access_token!=='string')throw new Error('Customer directory authorization unavailable');token=data.access_token;
    }
    const response=await request(`https://graph.microsoft.com/v1.0${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10_000),redirect:'error'});
    if(allowMissing&&response.status===404)return null;
    if(!response.ok)throw new Error('Customer directory operation failed');
    return response.status===204?null:await response.json() as T;
  }
  function userPath(id:string){if(!uuid.test(id))throw new Error('Invalid customer identity');return `/users/${id}`;}
  return {
    async assertCustomer(id:string){
      const path=userPath(id);
      const customer=await call<Customer>(`${path}?$select=id,creationType,identities`,'GET',undefined,true);
      if(!customer)return false;
      if(!['LocalAccount','SelfServiceSignUp','EmailVerified'].includes(customer.creationType??'') || !customer.identities?.some(i=>['emailAddress','federated'].includes(i.signInType))) throw new Error('Only customer identities can be managed');
      // Fail closed if role inspection fails. Do not grant this app any Entra admin role.
      const roles=await call<{value:{'@odata.type'?:string}[]; '@odata.nextLink'?:string}>(`${path}/transitiveMemberOf`);
      if(!roles||!Array.isArray(roles.value)||roles.value.some(role=>role['@odata.type']==='#microsoft.graph.directoryRole'||!role['@odata.type'])||roles['@odata.nextLink'])throw new Error('Privileged customer identity cannot be managed');
      return true;
    },
    async create(operationId:string,input:{email:string;displayName:string}){
      if(!uuid.test(operationId))throw new Error('Invalid operation');
      const nickname=`academy-${operationId}`;const upn=`${nickname}@${DOMAIN}`;
      const existing=await call<Customer>(`/users/${encodeURIComponent(upn)}?$select=id,userPrincipalName,mailNickname,identities`,'GET',undefined,true);
      if(existing){
        if(existing.userPrincipalName?.toLowerCase()!==upn||existing.mailNickname!==nickname||!existing.identities?.some(i=>i.signInType==='emailAddress'&&i.issuer===DOMAIN&&i.issuerAssignedId.toLowerCase()===input.email))throw new Error('Creation recovery identity mismatch');
        return existing.id;
      }
      // The generated password is never stored, logged, or returned. Owner uses hosted password reset.
      const created=await call<Customer>('/users','POST',{accountEnabled:false,displayName:input.displayName,mailNickname:nickname,userPrincipalName:upn,mail:input.email,identities:[{signInType:'emailAddress',issuer:DOMAIN,issuerAssignedId:input.email}],passwordProfile:{password:`Aa1!${randomBytes(32).toString('base64url')}`,forceChangePasswordNextSignIn:false},passwordPolicies:'DisablePasswordExpiration'});
      if(!created||!uuid.test(created.id))throw new Error('Customer creation response unavailable');return created.id;
    },
    async revoke(id:string){await call(`${userPath(id)}/revokeSignInSessions`,'POST');},
    async setEnabled(id:string,enabled:boolean){await call(userPath(id),'PATCH',{accountEnabled:enabled});},
    async update(id:string,displayName:string){await call(userPath(id),'PATCH',{displayName});},
    async remove(id:string){await call(userPath(id),'DELETE',undefined,true);},
  };
}
