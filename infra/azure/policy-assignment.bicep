targetScope = 'resourceGroup'
param policyId string
param allowedResourcePairs array
resource assignment 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: 'academy-fixed-inventory'
  properties: {
    policyDefinitionId: policyId
    enforcementMode: 'Default'
    parameters: { allowedResourcePairs: { value: allowedResourcePairs } }
    nonComplianceMessages: [ { message: 'Only the reviewed Academy Singapore names, types and fixed small SKUs are permitted.' } ]
  }
}
