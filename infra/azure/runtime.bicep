targetScope = 'resourceGroup'
param imageVersion string
param sshPublicKey string
param operatorCidr string
@allowed([70, 90])
param monthlyBudgetUsd int
param budgetStartDate string
param notificationEmail string
@allowed(['Basic', 'Standard'])
param registrySku string
param emailDomainName string
@allowed(['academyops'])
param adminUsername string = 'academyops'

var location = 'southeastasia'
var prefix = 'academy-sg'
var suffix = uniqueString(subscription().id, resourceGroup().id)
var storageName = 'acadback${suffix}'
var registryName = 'acadreg${suffix}'
var vaultName = 'acad-kv-${suffix}'
var functionStorageName = 'acadguard${suffix}'
var tags = { project: 'vfuture-academy', environment: 'production', costScope: 'academy-only' }

// These are intentionally existing: DNS verification and Entra SMTP identity are an explicit operator prerequisite.
resource acs 'Microsoft.Communication/communicationServices@2025-09-01' existing = { name: 'academy-sg-acs' }
resource emailService 'Microsoft.Communication/emailServices@2025-05-01' existing = { name: 'academy-sg-email' }
resource emailDomain 'Microsoft.Communication/emailServices/domains@2025-05-01' existing = { parent: emailService, name: emailDomainName }
resource smtpUsername 'Microsoft.Communication/communicationServices/smtpUsernames@2025-09-01' existing = { parent: acs, name: 'academy-runtime' }

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${prefix}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: concat([
      {
        name: 'https-only'
        properties: { priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourcePortRange: '*', destinationPortRange: '443', sourceAddressPrefix: 'Internet', destinationAddressPrefix: '*' }
      }
    ], empty(operatorCidr) ? [] : [
      {
        name: 'operator-ssh'
        properties: { priority: 110, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', sourcePortRange: '*', destinationPortRange: '22', sourceAddressPrefix: operatorCidr, destinationAddressPrefix: '*' }
      }
    ], [
      {
        name: 'deny-all-other-inbound'
        properties: { priority: 4096, direction: 'Inbound', access: 'Deny', protocol: '*', sourcePortRange: '*', destinationPortRange: '*', sourceAddressPrefix: '*', destinationAddressPrefix: '*' }
      }
    ])
  }
}
resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${prefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.77.0.0/24'] }
    subnets: [
      {
        name: 'runtime'
        properties: {
          addressPrefix: '10.77.0.0/27'
          networkSecurityGroup: { id: nsg.id }
          defaultOutboundAccess: false
          serviceEndpoints: [ { service: 'Microsoft.Storage' }, { service: 'Microsoft.KeyVault' } ]
        }
      }
    ]
  }
}
resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${prefix}-ip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static', publicIPAddressVersion: 'IPv4', idleTimeoutInMinutes: 4 }
}
resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${prefix}-nic'
  location: location
  tags: tags
  properties: {
    enableIPForwarding: false
    networkSecurityGroup: { id: nsg.id }
    ipConfigurations: [
      {
        name: 'primary'
        properties: { primary: true, privateIPAllocationMethod: 'Dynamic', subnet: { id: '${network.id}/subnets/runtime' }, publicIPAddress: { id: publicIp.id } }
      }
    ]
  }
}
resource dataDisk 'Microsoft.Compute/disks@2024-03-02' = {
  name: '${prefix}-data'
  location: location
  tags: tags
  sku: { name: 'Premium_LRS' }
  properties: { diskSizeGB: 64, tier: 'P6', creationData: { createOption: 'Empty' }, networkAccessPolicy: 'DenyAll', publicNetworkAccess: 'Disabled' }
}
resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: '${prefix}-vm'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    hardwareProfile: { vmSize: 'Standard_B2als_v2' }
    osProfile: {
      computerName: 'academy-sg'
      // The single fixed operator identity is part of the reviewed host scope.
      #disable-next-line adminusername-should-not-be-literal
      adminUsername: adminUsername
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: { publicKeys: [ { path: '/home/academyops/.ssh/authorized_keys', keyData: sshPublicKey } ] }
        patchSettings: { patchMode: 'ImageDefault', assessmentMode: 'ImageDefault' }
      }
    }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: 'ubuntu-24_04-lts', sku: 'server', version: imageVersion }
      osDisk: { name: '${prefix}-os', createOption: 'FromImage', diskSizeGB: 64, caching: 'ReadWrite', deleteOption: 'Detach', managedDisk: { storageAccountType: 'Premium_LRS' } }
      dataDisks: [ { lun: 0, name: dataDisk.name, createOption: 'Attach', caching: 'None', deleteOption: 'Detach', managedDisk: { id: dataDisk.id } } ]
    }
    networkProfile: { networkInterfaces: [ { id: nic.id, properties: { primary: true, deleteOption: 'Detach' } } ] }
    diagnosticsProfile: { bootDiagnostics: { enabled: false } }
  }
}
resource backups 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  sku: { name: 'Standard_ZRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    publicNetworkAccess: 'Enabled'
    // Function Consumption has no stable outbound VNet. Data-plane Entra RBAC remains mandatory.
    networkAcls: { bypass: 'None', defaultAction: 'Allow' }
    encryption: { keySource: 'Microsoft.Storage', services: { blob: { enabled: true, keyType: 'Account' } } }
  }
}
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: backups
  name: 'default'
  properties: { deleteRetentionPolicy: { enabled: true, days: 7 }, containerDeleteRetentionPolicy: { enabled: true, days: 7 }, isVersioningEnabled: false }
}
resource backupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobService, name: 'backups', properties: { publicAccess: 'None' } }
resource controlContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobService, name: 'control', properties: { publicAccess: 'None' } }
resource telemetryContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobService, name: 'telemetry', properties: { publicAccess: 'None' } }
resource guardStateContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobService, name: 'guard-state', properties: { publicAccess: 'None' } }
resource financialContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobService, name: 'financial-input', properties: { publicAccess: 'None' } }
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: backups
  name: 'default'
  properties: {
    policy: { rules: [
      { name: 'expire-transient-telemetry', enabled: true, type: 'Lifecycle', definition: { filters: { blobTypes: ['blockBlob'], prefixMatch: ['telemetry/'] }, actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 7 } } } } }
    ] }
  }
}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: tags
  sku: { name: registrySku }
  properties: { adminUserEnabled: false, publicNetworkAccess: 'Enabled', policies: { quarantinePolicy: { status: 'disabled' } } }
}
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
    networkAcls: { bypass: 'None', defaultAction: 'Deny', virtualNetworkRules: [ { id: '${network.id}/subnets/runtime' } ], ipRules: empty(operatorCidr) ? [] : [ { value: operatorCidr } ] }
  }
}
var blobReader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')
var blobWriter = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
resource vmBackups 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(backupContainer.id, vm.id, 'writer'), scope: backupContainer, properties: { principalId: vm.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: blobWriter } }
resource vmTelemetry 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(telemetryContainer.id, vm.id, 'writer'), scope: telemetryContainer, properties: { principalId: vm.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: blobWriter } }
resource vmControl 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(controlContainer.id, vm.id, 'reader'), scope: controlContainer, properties: { principalId: vm.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: blobReader } }
resource vmSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(vault.id, vm.id, 'secrets-read'), scope: vault, properties: { principalId: vm.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') } }
resource vmPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(registry.id, vm.id, 'pull'), scope: registry, properties: { principalId: vm.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d') } }

resource guardStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: functionStorageName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: { minimumTlsVersion: 'TLS1_2', supportsHttpsTrafficOnly: true, allowBlobPublicAccess: false, allowSharedKeyAccess: false, defaultToOAuthAuthentication: true }
}
resource guardBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = { parent: guardStorage, name: 'default', properties: {} }
resource guardPackages 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: guardBlobService, name: 'deployments', properties: { publicAccess: 'None' } }
resource guardPlan 'Microsoft.Web/serverfarms@2023-12-01' = { name: '${prefix}-guard-plan', location: location, tags: tags, kind: 'linux', sku: { name: 'Y1', tier: 'Dynamic' }, properties: { reserved: true } }
resource guard 'Microsoft.Web/sites@2023-12-01' = {
  name: 'academy-guard-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: guardPlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      functionAppScaleLimit: 1
      appSettings: [
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'AzureWebJobsStorage__accountName', value: guardStorage.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '${guardStorage.properties.primaryEndpoints.blob}deployments/cost-guard.zip' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID', value: 'SystemAssigned' }
      ]
    }
  }
}
resource guardHostStorage 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(guardStorage.id, guard.id, 'host-blob'), scope: guardStorage, properties: { principalId: guard.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b') } }
resource guardQueue 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(guardStorage.id, guard.id, 'host-queue'), scope: guardStorage, properties: { principalId: guard.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88') } }
resource guardControl 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(controlContainer.id, guard.id, 'writer'), scope: controlContainer, properties: { principalId: guard.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: blobWriter } }
resource guardTelemetry 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(telemetryContainer.id, guard.id, 'reader'), scope: telemetryContainer, properties: { principalId: guard.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: blobReader } }
resource guardState 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(guardStateContainer.id, guard.id, 'writer'), scope: guardStateContainer, properties: { principalId: guard.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: blobWriter } }
resource guardFinancial 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(financialContainer.id, guard.id, 'reader'), scope: financialContainer, properties: { principalId: guard.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: blobReader } }
resource observeRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, 'academy-cost-observe')
  properties: { roleName: 'Academy cost observation ${suffix}', type: 'CustomRole', assignableScopes: [resourceGroup().id], permissions: [ { actions: ['Microsoft.Resources/subscriptions/resourceGroups/read', 'Microsoft.CostManagement/query/action'], notActions: [], dataActions: [], notDataActions: [] } ] }
}
resource guardObserve 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(resourceGroup().id, guard.id, 'observe'), properties: { principalId: guard.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: observeRole.id } }
resource stopRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, 'academy-exact-vm-stop')
  properties: { roleName: 'Academy VM deallocate ${suffix}', type: 'CustomRole', description: 'Read and deallocate only; no delete, resize, start, or subscription control.', assignableScopes: [resourceGroup().id], permissions: [ { actions: ['Microsoft.Compute/virtualMachines/read', 'Microsoft.Compute/virtualMachines/instanceView/read', 'Microsoft.Compute/virtualMachines/deallocate/action'], notActions: [], dataActions: [], notDataActions: [] } ] }
}
resource guardStop 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(vm.id, guard.id, 'deallocate'), scope: vm, properties: { principalId: guard.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: stopRole.id } }
resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: '${prefix}-monthly-budget'
  properties: {
    category: 'Cost'
    amount: monthlyBudgetUsd
    timeGrain: 'Monthly'
    timePeriod: { startDate: '${budgetStartDate}T00:00:00Z' }
    notifications: {
      warning: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 80, thresholdType: 'Actual', contactEmails: [notificationEmail] }
      restrict: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 90, thresholdType: 'Actual', contactEmails: [notificationEmail] }
      stop: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 95, thresholdType: 'Actual', contactEmails: [notificationEmail] }
    }
  }
}
output acsLinkedDomains array = acs.properties.linkedDomains
output acsSmtpUsername string = smtpUsername.properties.username
output acsEmailDomainId string = emailDomain.id
output guardPrincipalId string = guard.identity.principalId
output vmResourceId string = vm.id
output vmPrincipalId string = vm.identity.principalId
output backupAccountName string = backups.name
output keyVaultName string = vault.name
output registryLoginServer string = registry.properties.loginServer
output publicAddress string = publicIp.properties.ipAddress
output guardAppName string = guard.name
output guardStorageAccountName string = guardStorage.name
output allowedResourcePairs array = [
  'microsoft.communication/communicationservices|${toLower(acs.name)}'
  'microsoft.communication/communicationservices/smtpusernames|${toLower(acs.name)}/academy-runtime'
  'microsoft.communication/emailservices|${toLower(emailService.name)}'
  'microsoft.communication/emailservices/domains|${toLower(emailService.name)}/${toLower(emailDomainName)}'
  'microsoft.network/networksecuritygroups|${nsg.name}'
  'microsoft.network/virtualnetworks|${network.name}'
  'microsoft.network/virtualnetworks/subnets|${network.name}/runtime'
  'microsoft.network/publicipaddresses|${publicIp.name}'
  'microsoft.network/networkinterfaces|${nic.name}'
  'microsoft.compute/disks|${dataDisk.name}'
  'microsoft.compute/disks|${prefix}-os'
  'microsoft.compute/virtualmachines|${vm.name}'
  'microsoft.storage/storageaccounts|${backups.name}'
  'microsoft.storage/storageaccounts/blobservices|${backups.name}/default'
  'microsoft.storage/storageaccounts/blobservices/containers|${backups.name}/default/backups'
  'microsoft.storage/storageaccounts/blobservices/containers|${backups.name}/default/control'
  'microsoft.storage/storageaccounts/blobservices/containers|${backups.name}/default/telemetry'
  'microsoft.storage/storageaccounts/blobservices/containers|${backups.name}/default/guard-state'
  'microsoft.storage/storageaccounts/blobservices/containers|${backups.name}/default/financial-input'
  'microsoft.storage/storageaccounts/managementpolicies|${backups.name}/default'
  'microsoft.containerregistry/registries|${registry.name}'
  'microsoft.keyvault/vaults|${vault.name}'
  'microsoft.keyvault/vaults/secrets|${vault.name}/academy-runtime-env'
  'microsoft.keyvault/vaults/secrets|${vault.name}/academy-tls-cert'
  'microsoft.keyvault/vaults/secrets|${vault.name}/academy-tls-key'
  'microsoft.storage/storageaccounts|${guardStorage.name}'
  'microsoft.storage/storageaccounts/blobservices|${guardStorage.name}/default'
  'microsoft.storage/storageaccounts/blobservices/containers|${guardStorage.name}/default/deployments'
  'microsoft.web/serverfarms|${guardPlan.name}'
  'microsoft.web/sites|${guard.name}'
  'microsoft.web/sites/config|${guard.name}/web'
  'microsoft.web/sites/config|${guard.name}/appsettings'
  'microsoft.consumption/budgets|${budget.name}'
]
