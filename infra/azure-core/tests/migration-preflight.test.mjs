import test from 'node:test';
import assert from 'node:assert/strict';
import {scopePreflight,migrationTargetChecks,policy} from '../preflight.mjs';
const scope=`/subscriptions/${policy.subscriptionId}/resourceGroups/${policy.resourceGroup}`;
const outputs={storageAccountName:{value:'vfastabcdefghijklm'},vaultName:{value:'vfakvabcdefghijklm'},postgresName:{value:'vfa-core-pg-abcdefghijklm'},environmentName:{value:'vfa-core-environment'}};
function fake(calls){return args=>{calls.push(args);
  if(args[0]==='account')return{id:policy.subscriptionId,tenantId:policy.tenantId,state:'Enabled'};
  if(args[0]==='group')return{id:scope,location:policy.location};
  if(args[0]==='resource')return{id:args[args.indexOf('--ids')+1]};
  if(args[0]==='provider')return{registrationState:'Registered'};
  if(args[0]==='postgres')return{version:'17',sku:{name:'Standard_B1ms'},network:{publicNetworkAccess:'Disabled',delegatedSubnetResourceId:scope+'/providers/Microsoft.Network/virtualNetworks/vfa-core/subnets/postgres'}};
  if(args[0]==='containerapp')return{properties:{vnetConfiguration:{infrastructureSubnetId:scope+'/providers/Microsoft.Network/virtualNetworks/vfa-core/subnets/containers'}}};
  throw Error('Unexpected preflight command');
};}
test('migration read/start preflight only checks account, RG and storage target',()=>{
  const calls=[],run=fake(calls);scopePreflight({run});migrationTargetChecks(outputs,{run});
  assert.deepEqual(calls.map(c=>c[0]),['account','group','resource']);
});
test('migration prepare checks private PG/VNet and only migration providers',()=>{
  const calls=[],run=fake(calls);migrationTargetChecks(outputs,{prepare:true,run});
  const namespaces=calls.filter(c=>c[0]==='provider').map(c=>c[c.indexOf('--namespace')+1]);
  assert.deepEqual(namespaces,['Microsoft.App','Microsoft.ManagedIdentity','Microsoft.Storage','Microsoft.KeyVault','Microsoft.Network','Microsoft.DBforPostgreSQL']);
  assert.equal(calls.some(c=>c.includes('list-skus')||c[0]==='functionapp'),false);
  assert.throws(()=>migrationTargetChecks(outputs,{prepare:true,run:args=>args[0]==='postgres'?{version:'17',sku:{name:'Standard_B1ms'},network:{publicNetworkAccess:'Enabled'}}:run(args)}));
});
test('minimal checks still fail closed on wrong subscription or resource ownership',()=>{
  assert.throws(()=>scopePreflight({run:()=>({id:'wrong',tenantId:policy.tenantId,state:'Enabled'})}));
  assert.throws(()=>migrationTargetChecks(outputs,{run:()=>({id:'/subscriptions/other/resourceGroups/other'})}));
});
