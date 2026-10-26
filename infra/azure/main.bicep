targetScope = 'subscription'

@description('An exact Canonical ubuntu-24_04-lts server image version inspected in southeastasia; latest is not accepted by the preflight.')
param imageVersion string
param sshPublicKey string
@description('Empty disables SSH. The preflight only accepts a single explicit operator IPv4 /32.')
param operatorCidr string = ''
@allowed([70, 90])
param monthlyBudgetUsd int = 90
param budgetStartDate string
param notificationEmail string
@allowed(['Basic', 'Standard'])
param registrySku string = 'Basic'
param emailDomainName string

var academyGroupName = 'rg-vfuture-academy-sg'
resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: academyGroupName
  location: 'southeastasia'
  tags: { project: 'vfuture-academy', environment: 'production', costScope: 'academy-only' }
}
module runtime './runtime.bicep' = {
  name: 'academy-fixed-runtime'
  scope: group
  params: {
    imageVersion: imageVersion
    sshPublicKey: sshPublicKey
    operatorCidr: operatorCidr
    monthlyBudgetUsd: monthlyBudgetUsd
    budgetStartDate: budgetStartDate
    notificationEmail: notificationEmail
    registrySku: registrySku
    emailDomainName: emailDomainName
  }
}
module guardrails './guardrails.bicep' = {
  name: 'academy-resource-guardrails'
  params: {
    resourceGroupName: academyGroupName
    allowedResourcePairs: runtime.outputs.allowedResourcePairs
    registrySku: registrySku
  }
}
// Read-only subscription costs are needed to account for other projects sharing the grant.
// No subscription-scoped write or stop rights are given to either workload identity.
resource sharedCostRead 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, academyGroupName, 'academy-shared-cost-read')
  properties: {
    principalId: runtime.outputs.guardPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '72fafb9e-0641-4937-9268-a91bfd8191a3')
  }
}
output runtimeOutputs object = runtime.outputs
