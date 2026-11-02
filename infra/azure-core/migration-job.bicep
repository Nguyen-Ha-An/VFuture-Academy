targetScope = 'resourceGroup'
@allowed(['southeastasia'])
param location string = 'southeastasia'
param prefix string = 'vfa-core'
param vaultName string
@description('Exact approved PostgreSQL FQDN from the base deployment output.')
param postgresHost string
param storageAccountName string
param packageBlobName string
@minLength(64)
@maxLength(64)
param packageSha256 string
@description('Unique immutable receipt name; re-running a completed import is refused by the DB importer.')
param receiptBlobName string
param packageKeySecretName string
@allowed(['schema-import','configure-authenticator','probe'])
param migrationAction string = 'schema-import'
param authenticatorPasswordSecretName string = ''
param authenticatorExpiresAt string = ''
var approvedVaultHost = '${vaultName}${az.environment().suffixes.keyvaultDns}'
var tags = { product: 'academy', component: 'migration', owner: 'an@vfuturelabs.org' }
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = { name: '${prefix}-environment' }
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: vaultName }
resource adminUri 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = { parent: vault, name: 'migration-admin-uri' }
resource key 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = { parent: vault, name: packageKeySecretName }
resource authenticatorSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = { parent: vault, name: empty(authenticatorPasswordSecretName) ? 'unused-authenticator' : authenticatorPasswordSecretName }
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: storageAccountName }
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = { parent: storage, name: 'default' }
resource packages 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobs, name: 'migration-packages', properties: { publicAccess: 'None' } }
resource receipts 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobs, name: 'migration-receipts', properties: { publicAccess: 'None' } }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = { name: '${prefix}-migration-identity', location: location, tags: tags }
var kvReader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions','4633458b-17de-408a-b874-0445c86b69e6')
resource adminGrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = { scope: adminUri, name: guid(adminUri.id,identity.id,kvReader), properties: { roleDefinitionId: kvReader, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' } }
resource keyGrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = { scope: key, name: guid(key.id,identity.id,kvReader), properties: { roleDefinitionId: kvReader, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' } }
resource authenticatorGrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (migrationAction == 'configure-authenticator') { scope: authenticatorSecret, name: guid(authenticatorSecret.id,identity.id,kvReader), properties: { roleDefinitionId: kvReader, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' } }
resource packageGrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = { scope: packages, name: guid(packages.id,identity.id,'read'), properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'), principalId: identity.properties.principalId, principalType: 'ServicePrincipal' } }
resource receiptGrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = { scope: receipts, name: guid(receipts.id,identity.id,'write'), properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','ba92f5b4-2d11-453d-a403-e96b0029c9fe'), principalId: identity.properties.principalId, principalType: 'ServicePrincipal' } }
resource job 'Microsoft.App/jobs@2024-03-01' = {
  name: '${prefix}-migration'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      // Secrets are fetched with this same identity at runtime; avoid platform reference validation.
      secrets: []
    }
    template: {
      containers: [{
        name: 'migration'
        image: 'docker.io/library/node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da'
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        command: ['node']
        args: ['--input-type=module', '-e', '${loadTextContent('archive-policy.mjs')}\n${loadTextContent('migration/bootstrap.mjs')}']
        env: concat([
          { name: 'MIGRATION_ACTION', value: migrationAction }
          { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
          { name: 'AZURE_TARGET_HOST', value: postgresHost }
          { name: 'MIGRATION_VAULT_HOST', value: approvedVaultHost }
          { name: 'MIGRATION_ADMIN_SECRET_URL', value: 'https://${approvedVaultHost}/secrets/migration-admin-uri' }
          { name: 'MIGRATION_PACKAGE_KEY_SECRET_URL', value: 'https://${approvedVaultHost}/secrets/${packageKeySecretName}' }
          { name: 'MIGRATION_PACKAGE_URL', value: '${storage.properties.primaryEndpoints.blob}migration-packages/${packageBlobName}' }
          { name: 'MIGRATION_PACKAGE_SHA256', value: packageSha256 }
          { name: 'MIGRATION_RECEIPT_URL', value: '${storage.properties.primaryEndpoints.blob}migration-receipts/${receiptBlobName}' }
        ], migrationAction == 'configure-authenticator' ? [{ name: 'MIGRATION_AUTHENTICATOR_SECRET_URL', value: 'https://${approvedVaultHost}/secrets/${authenticatorPasswordSecretName}' }, { name: 'AZURE_AUTHENTICATOR_EXPIRES_AT', value: authenticatorExpiresAt }] : [])
      }]
    }
  }
  dependsOn: [adminGrant,keyGrant,authenticatorGrant,packageGrant,receiptGrant]
}
output jobName string = job.name
output receiptUrl string = '${storage.properties.primaryEndpoints.blob}migration-receipts/${receiptBlobName}'
