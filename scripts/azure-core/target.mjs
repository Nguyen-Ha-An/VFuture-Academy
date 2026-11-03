import { Client } from 'pg';
/** Validate before constructing any client; never include connection values in errors.
 * @param {Readonly<Record<string,string|undefined>>} source
 * @param {{statement_timeout?:number}} options
 */
export function createAzureTargetClient(source=process.env,{statement_timeout}={}){
  let url;
  try{
    const expected=source.AZURE_TARGET_HOST?.toLowerCase();
    url=new URL(source.AZURE_DATABASE_URL??'');
    if(!expected||! /^[a-z0-9][a-z0-9-]{0,62}\.postgres\.database\.azure\.com$/.test(expected)
      ||!['postgres:','postgresql:'].includes(url.protocol)
      ||url.hostname.toLowerCase()!==expected||url.pathname!=='/academy'
      ||(url.port&&url.port!=='5432')||decodeURIComponent(url.username)!=='academy_admin'||!url.password||url.href.includes('#')
      ||[...url.searchParams.keys()].some(key=>key!=='sslmode')
      ||url.searchParams.getAll('sslmode').length>1
      ||(url.searchParams.has('sslmode')&&url.searchParams.get('sslmode')!=='verify-full'))throw new Error();
    // pg accepts query-string host/database overrides. Reject them above, then
    // remove URI TLS settings so certificate validation cannot be downgraded.
    url.hostname=expected;url.username='academy_admin';url.search='';
  }catch{throw new Error('Invalid Azure migration target');}
  return new Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,
    ...(statement_timeout===undefined?{}:{statement_timeout})});
}
