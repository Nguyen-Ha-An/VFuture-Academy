targetScope = 'subscription'
@allowed(['rg-vfuture-academy-sg'])
param resourceGroupName string
param allowedResourcePairs array
@allowed(['Basic', 'Standard'])
param registrySku string

resource academy 'Microsoft.Resources/resourceGroups@2024-03-01' existing = { name: resourceGroupName }
resource policy 'Microsoft.Authorization/policyDefinitions@2023-04-01' = {
  name: 'vfuture-academy-fixed-inventory'
  properties: {
    policyType: 'Custom'
    mode: 'All'
    displayName: 'Academy fixed Singapore resource inventory'
    description: 'Deny expansion outside the reviewed names, types, region and small resource SKUs. Assigned only to Academy.'
    parameters: { allowedResourcePairs: { type: 'Array' } }
    policyRule: {
      if: {
        anyOf: [
          loadJsonContent('inventory-policy.json')
          { field: 'type', notIn: ['Microsoft.Communication/communicationServices', 'Microsoft.Communication/communicationServices/smtpUsernames', 'Microsoft.Communication/emailServices', 'Microsoft.Communication/emailServices/domains', 'Microsoft.Compute/virtualMachines', 'Microsoft.Compute/disks', 'Microsoft.Network/networkSecurityGroups', 'Microsoft.Network/virtualNetworks', 'Microsoft.Network/virtualNetworks/subnets', 'Microsoft.Network/publicIPAddresses', 'Microsoft.Network/networkInterfaces', 'Microsoft.Storage/storageAccounts', 'Microsoft.Storage/storageAccounts/blobServices', 'Microsoft.Storage/storageAccounts/blobServices/containers', 'Microsoft.Storage/storageAccounts/managementPolicies', 'Microsoft.ContainerRegistry/registries', 'Microsoft.KeyVault/vaults', 'Microsoft.KeyVault/vaults/secrets', 'Microsoft.Web/serverfarms', 'Microsoft.Web/sites', 'Microsoft.Web/sites/config', 'Microsoft.Consumption/budgets', 'Microsoft.Authorization/roleAssignments', 'Microsoft.Authorization/roleDefinitions', 'Microsoft.Authorization/policyAssignments', 'Microsoft.Resources/deployments'] }
          { allOf: [ { field: 'location', exists: true }, { field: 'location', notIn: ['southeastasia', 'global'] } ] }
          { allOf: [ { field: 'type', equals: 'Microsoft.Compute/virtualMachines' }, { field: 'Microsoft.Compute/virtualMachines/sku.name', notEquals: 'Standard_B2als_v2' } ] }
          { allOf: [ { field: 'type', equals: 'Microsoft.Compute/disks' }, { anyOf: [ { field: 'Microsoft.Compute/disks/sku.name', notEquals: 'Premium_LRS' }, { field: 'Microsoft.Compute/disks/diskSizeGB', greater: 64 } ] } ] }
          { allOf: [ { field: 'type', equals: 'Microsoft.Storage/storageAccounts' }, { field: 'Microsoft.Storage/storageAccounts/sku.name', notIn: ['Standard_ZRS', 'Standard_LRS'] } ] }
          { allOf: [ { field: 'type', equals: 'Microsoft.ContainerRegistry/registries' }, { field: 'Microsoft.ContainerRegistry/registries/sku.name', notEquals: registrySku } ] }
          { allOf: [ { field: 'type', equals: 'Microsoft.Web/serverfarms' }, { field: 'Microsoft.Web/serverfarms/sku.name', notEquals: 'Y1' } ] }
        ]
      }
      then: { effect: 'deny' }
    }
  }
}
module assignment './policy-assignment.bicep' = {
  name: 'academy-policy-assignment'
  scope: academy
  params: { policyId: policy.id, allowedResourcePairs: allowedResourcePairs }
}
