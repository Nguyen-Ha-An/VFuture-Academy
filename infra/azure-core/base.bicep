targetScope = 'resourceGroup'

@allowed(['southeastasia'])
param location string = 'southeastasia'
@minLength(3)
@maxLength(18)
param prefix string = 'vfa-core'
@secure()
param postgresAdminPassword string
@secure()
@description('Private TLS PostgREST authenticator connection URI, never the administrator URI.')
param postgrestDatabaseUri string = ''
@secure()
param postgrestJwtSecret string = ''
@secure()
@minLength(32)
param cronSecret string
@secure()
@minLength(32)
param emailDedupeSecret string
param emailDomainName string = 'notify.academy.vfuturelabs.org'
param emailSenderLocalPart string = 'noreply'
@description('Domain linking requires completed DNS verification; first deployment leaves linking disabled.')
param linkVerifiedEmailDomain bool = false
@description('First day of a month, no more than 12 months in the past. UTC ISO8601.')
param budgetStartDate string
param budgetEndDate string = '2036-11-01T00:00:00Z'

@description('Enable after private schema bootstrap and authenticator provisioning. No customer-tenant IDs needed.')
param deployPostgrest bool = false

var tags = { product: 'academy', component: 'azure-core', owner: 'an@vfuturelabs.org', benefitExpiry: '2027-10-23' }
var suffix = uniqueString(resourceGroup().id)
var postgresName = '${prefix}-pg-${suffix}'
var kvName = 'vfakv${suffix}'
var storageName = 'vfast${suffix}'
var postgrestImage = 'docker.io/postgrest/postgrest:v13.0.7@sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228'

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${prefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.42.0.0/16'] }
    subnets: [
      { name: 'postgres', properties: { addressPrefix: '10.42.0.0/24', delegations: [{ name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }] } }
      { name: 'containers', properties: { addressPrefix: '10.42.2.0/23', delegations: [{ name: 'containers', properties: { serviceName: 'Microsoft.App/environments' } }] } }
    ]
  }
}
resource dns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${prefix}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}
resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: dns
  name: 'academy'
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: vnet.id } }
}
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '17'
    administratorLogin: 'academy_admin'
    administratorLoginPassword: postgresAdminPassword
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
    storage: { storageSizeGB: 32, autoGrow: 'Disabled', type: 'Premium_LRS' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Disabled', delegatedSubnetResourceId: '${vnet.id}/subnets/postgres', privateDnsZoneArmResourceId: dns.id }
    maintenanceWindow: { customWindow: 'Enabled', dayOfWeek: 0, startHour: 20, startMinute: 0 }
  }
  dependsOn: [dnsLink]
}
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'academy'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}
resource tls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'require_secure_transport'
  properties: { value: 'ON', source: 'user-override' }
}
resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: { value: 'PGCRYPTO', source: 'user-override' }
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = { name: '${prefix}-api-identity', location: location, tags: tags }
resource functionIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = { name: '${prefix}-functions-identity', location: location, tags: tags }
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
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
  }
}
resource dbSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (deployPostgrest) { parent: vault, name: 'postgrest-db-uri', properties: { value: postgrestDatabaseUri } }
resource jwtSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (deployPostgrest) { parent: vault, name: 'postgrest-jwt', properties: { value: postgrestJwtSecret } }
resource migrationAdminSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = { parent: vault, name: 'migration-admin-uri', properties: { value: 'postgresql://academy_admin:${uriComponent(postgresAdminPassword)}@${postgres.properties.fullyQualifiedDomainName}/academy?sslmode=verify-full' } }
resource sweepSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = { parent: vault, name: 'exam-sweep', properties: { value: cronSecret } }
resource dedupeSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = { parent: vault, name: 'email-dedupe', properties: { value: emailDedupeSecret } }
var secretReaderRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
resource apiDbReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployPostgrest) { scope: dbSecret, name: guid(dbSecret.id, identity.id, secretReaderRole), properties: { roleDefinitionId: secretReaderRole, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' } }
resource apiJwtReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployPostgrest) { scope: jwtSecret, name: guid(jwtSecret.id, identity.id, secretReaderRole), properties: { roleDefinitionId: secretReaderRole, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' } }
resource functionSweepReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = { scope: sweepSecret, name: guid(sweepSecret.id, functionIdentity.id, secretReaderRole), properties: { roleDefinitionId: secretReaderRole, principalId: functionIdentity.properties.principalId, principalType: 'ServicePrincipal' } }
resource functionDedupeReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = { scope: dedupeSecret, name: guid(dedupeSecret.id, functionIdentity.id, secretReaderRole), properties: { roleDefinitionId: secretReaderRole, principalId: functionIdentity.properties.principalId, principalType: 'ServicePrincipal' } }
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-environment'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: { infrastructureSubnetId: '${vnet.id}/subnets/containers', internal: false }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
  }
}
resource api 'Microsoft.App/containerApps@2024-03-01' = if (deployPostgrest) {
  name: '${prefix}-data'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3000, transport: 'http', allowInsecure: false }
      secrets: [
        { name: 'db-uri', keyVaultUrl: dbSecret!.properties.secretUri, identity: identity.id }
        { name: 'jwt', keyVaultUrl: jwtSecret!.properties.secretUri, identity: identity.id }
        // Public CA roots are deliberately distributed via a read-only secret volume.
        #disable-next-line use-secure-value-for-secure-inputs
        { name: 'postgres-roots', value: loadTextContent('postgres-roots.crt') }
      ]
    }
    template: {
      containers: [{
        name: 'postgrest'
        image: postgrestImage
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        volumeMounts: [{ volumeName: 'postgres-roots', mountPath: '/etc/academy-tls' }]
        env: [
          { name: 'PGRST_DB_URI', secretRef: 'db-uri' }
          { name: 'PGSSLROOTCERT', value: '/etc/academy-tls/roots.crt' }
          { name: 'PGSSLMODE', value: 'verify-full' }
          { name: 'PGRST_JWT_SECRET', secretRef: 'jwt' }
          { name: 'PGRST_JWT_AUD', value: 'academy-data' }
          { name: 'PGRST_DB_SCHEMAS', value: 'public' }
          { name: 'PGRST_DB_PRE_REQUEST', value: 'academy_private.authorize_request' }
          { name: 'PGRST_DB_POOL', value: '8' }
          { name: 'PGRST_DB_POOL_ACQUISITION_TIMEOUT', value: '10' }
          { name: 'PGRST_SERVER_PORT', value: '3000' }
          { name: 'PGRST_ADMIN_SERVER_PORT', value: '3001' }
          { name: 'PGRST_LOG_LEVEL', value: 'error' }
          { name: 'PGRST_OPENAPI_MODE', value: 'disabled' }
        ]
        probes: [
          { type: 'Liveness', httpGet: { path: '/live', port: 3001 }, initialDelaySeconds: 10, periodSeconds: 30 }
          { type: 'Readiness', httpGet: { path: '/ready', port: 3001 }, initialDelaySeconds: 5, periodSeconds: 10 }
        ]
      }]
      volumes: [{ name: 'postgres-roots', storageType: 'Secret', secrets: [{ secretRef: 'postgres-roots', path: 'roots.crt' }] }]
      scale: { minReplicas: 0, maxReplicas: 1, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '20' } } }] }
    }
  }
  dependsOn: [apiDbReader, apiJwtReader, database]
}
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: { minimumTlsVersion: 'TLS1_2', supportsHttpsTrafficOnly: true, allowBlobPublicAccess: false, allowSharedKeyAccess: false }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = { parent: storage, name: 'default' }
resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobs, name: 'function-releases', properties: { publicAccess: 'None' } }
resource tables 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = { parent: storage, name: 'default' }
resource emailState 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = { parent: tables, name: 'EmailState' }
var storageRoles = [
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b' // Blob Data Owner: timer host locks and deployment packages.
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88' // Queue Data Contributor: Functions host.
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3' // Table Data Contributor: durable email state.
]
resource storageGrants 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for role in storageRoles: {
  scope: storage
  name: guid(storage.id, functionIdentity.id, role)
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role), principalId: functionIdentity.properties.principalId, principalType: 'ServicePrincipal' }
}]
resource email 'Microsoft.Communication/emailServices@2023-03-31' = { name: '${prefix}-email', location: 'global', tags: tags, properties: { dataLocation: 'Asia Pacific' } }
resource domain 'Microsoft.Communication/emailServices/domains@2023-03-31' = { parent: email, name: emailDomainName, location: 'global', properties: { domainManagement: 'CustomerManaged', userEngagementTracking: 'Disabled' } }
resource sender 'Microsoft.Communication/emailServices/domains/senderUsernames@2023-03-31' = { parent: domain, name: emailSenderLocalPart, properties: { username: emailSenderLocalPart, displayName: 'VFuture Academy' } }
resource acs 'Microsoft.Communication/communicationServices@2023-03-31' = { name: '${prefix}-communication', location: 'global', tags: tags, properties: { dataLocation: 'Asia Pacific', linkedDomains: linkVerifiedEmailDomain ? [domain.id] : [] } }
resource emailRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, 'academy-email-send')
  properties: { roleName: '${prefix}-email-send-${suffix}', type: 'CustomRole', description: 'ACS REST email managed identity permissions; only assigned on Academy ACS.', assignableScopes: [resourceGroup().id], permissions: [{ actions: ['Microsoft.Communication/CommunicationServices/Read', 'Microsoft.Communication/CommunicationServices/Write'], notActions: [], dataActions: [], notDataActions: [] }] }
}
resource emailGrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = { scope: acs, name: guid(acs.id, functionIdentity.id, emailRole.id), properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', emailRole.name), principalId: functionIdentity.properties.principalId, principalType: 'ServicePrincipal' } }
module costReader 'cost-reader.bicep' = {
  name: 'academy-cost-reader'
  scope: subscription()
  params: { principalId: functionIdentity.properties.principalId }
}
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'academy-core-usd35-soft'
  properties: {
    amount: 35
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStartDate, endDate: budgetEndDate }
    notifications: {
      actual50: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 50, thresholdType: 'Actual', contactEmails: ['an@vfuturelabs.org'] }
      actual80: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 80, thresholdType: 'Actual', contactEmails: ['an@vfuturelabs.org'] }
      actual100: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 100, thresholdType: 'Actual', contactEmails: ['an@vfuturelabs.org'] }
      forecast100: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 100, thresholdType: 'Forecasted', contactEmails: ['an@vfuturelabs.org'] }
    }
  }
}
output postgrestUrl string = deployPostgrest ? 'https://${api!.properties.configuration.ingress.fqdn}' : ''
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output vaultName string = vault.name
output emailDomainResourceId string = domain.id
output emailVerificationRecords object = domain.properties.verificationRecords
output storageAccountName string = storage.name
output functionIdentityId string = functionIdentity.id
output functionIdentityClientId string = functionIdentity.properties.clientId
output storageBlobEndpoint string = storage.properties.primaryEndpoints.blob
output storageTableEndpoint string = storage.properties.primaryEndpoints.table
output deploymentContainerName string = deploymentContainer.name
output sweepSecretUri string = sweepSecret.properties.secretUri
output dedupeSecretUri string = dedupeSecret.properties.secretUri
output acsHostName string = acs.properties.hostName
output environmentName string = environment.name
output postgresName string = postgres.name
