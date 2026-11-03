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
@description('Hold the data API off while independently rehearsing email; enable only after database reconciliation and authenticator provisioning.')
param deployPostgrest bool = true
@secure()
@minLength(32)
param cronSecret string
@secure()
@minLength(32)
param emailDedupeSecret string
param entraExternalTenantId string
param entraExtensionIssuer string
param entraExtensionAudience string
param entraExtensionId string
param entraClientId string
param examSweepUrl string
@description('Enable only after disabling and verifying every legacy cron owner.')
param examSweepEnabled bool = false
@allowed([0,1])
@description('Explicit operator choice after cold/warm testing; one512MiB HTTP instance has aboutUSD6.48/30day baseline at reviewed rate.')
param httpAlwaysReady int = 0
param emailDomainName string = 'notify.academy.vfuturelabs.org'
param emailSenderLocalPart string = 'noreply'
@description('Domain linking requires completed DNS verification; first deployment leaves linking disabled.')
param linkVerifiedEmailDomain bool = false
@description('First day of a month, no more than 12 months in the past. UTC ISO8601.')
param budgetStartDate string
param budgetEndDate string = '2036-11-01T00:00:00Z'
@description('Nonsecret monthly outside-RG identity billing evidence; unknown values trigger action-required mail.')
param costOperator object = loadJsonContent('operator.example.json')

var tags = { product: 'academy', component: 'azure-core', owner: 'an@vfuturelabs.org', benefitExpiry: '2027-10-23' }
var suffix = uniqueString(resourceGroup().id)

module base 'base.bicep' = {
  name: 'academy-core-base'
  params: {
    location: location
    prefix: prefix
    postgresAdminPassword: postgresAdminPassword
    postgrestDatabaseUri: postgrestDatabaseUri
    postgrestJwtSecret: postgrestJwtSecret
    cronSecret: cronSecret
    emailDedupeSecret: emailDedupeSecret
    emailDomainName: emailDomainName
    emailSenderLocalPart: emailSenderLocalPart
    linkVerifiedEmailDomain: linkVerifiedEmailDomain
    budgetStartDate: budgetStartDate
    budgetEndDate: budgetEndDate
    deployPostgrest: deployPostgrest
  }
}
resource functionIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = { name: '${prefix}-functions-identity' }
resource queueStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: 'vfast${suffix}' }
resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = { parent: queueStorage, name: 'default', dependsOn: [base] }
resource emailQueues 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = [for name in ['email-otp','email-status','email-delivery','email-otp-poison']: { parent: queueService, name: name }]
resource acsSource 'Microsoft.Communication/communicationServices@2023-03-31' existing = { name: '${prefix}-communication' }
resource emailEvents 'Microsoft.EventGrid/systemTopics@2022-06-15' = {
  name: '${prefix}-email-events'
  location: 'global'
  identity: { type: 'SystemAssigned' }
  properties: { source: acsSource.id, topicType: 'Microsoft.Communication.CommunicationServices' }
  dependsOn: [base]
}
resource eventQueueGrant 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // Event Grid validates Storage Queue delivery authorization at storage-account scope.
  // Sender-only grants message add; it grants no message read, process, or delete.
  scope: queueStorage
  name: guid(queueStorage.id,emailEvents.id,'event-send')
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','c6a89b2d-59bc-44d0-9896-0f6e12d7b80a'), principalId: emailEvents.identity.principalId, principalType: 'ServicePrincipal' }
  dependsOn: [emailQueues]
}
resource deliveryEvents 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2022-06-15' = {
  parent: emailEvents
  name: 'delivery-status'
  properties: {
    deliveryWithResourceIdentity: { identity: { type: 'SystemAssigned' }, destination: { endpointType: 'StorageQueue', properties: { resourceId: queueStorage.id, queueName: 'email-delivery', queueMessageTimeToLiveInSeconds: 300 } } }
    eventDeliverySchema: 'EventGridSchema'
    filter: { includedEventTypes: ['Microsoft.Communication.EmailDeliveryReportReceived'] }
    retryPolicy: { maxDeliveryAttempts: 5, eventTimeToLiveInMinutes: 10 }
  }
  dependsOn: [eventQueueGrant]
}
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = { name: '${prefix}-functions-plan', location: location, tags: tags, kind: 'functionapp', sku: { name: 'FC1', tier: 'FlexConsumption' }, properties: { reserved: true } }
resource functions 'Microsoft.Web/sites@2024-04-01' = {
  name: '${prefix}-functions-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${functionIdentity.id}': {} } }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    keyVaultReferenceIdentity: base.outputs.functionIdentityId
    functionAppConfig: {
      runtime: { name: 'node', version: '22' }
      deployment: { storage: { type: 'blobContainer', value: '${base.outputs.storageBlobEndpoint}${base.outputs.deploymentContainerName}', authentication: { type: 'UserAssignedIdentity', userAssignedIdentityResourceId: base.outputs.functionIdentityId } } }
      scaleAndConcurrency: { alwaysReady: httpAlwaysReady == 1 ? [{ name: 'http', instanceCount: 1 }] : [], maximumInstanceCount: 40, instanceMemoryMB: 512, triggers: { http: { perInstanceConcurrency: 8 } } }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: base.outputs.storageAccountName }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'AzureWebJobsStorage__clientId', value: base.outputs.functionIdentityClientId }
        { name: 'AZURE_CLIENT_ID', value: base.outputs.functionIdentityClientId }
        { name: 'EMAIL_QUEUE_URL', value: queueStorage.properties.primaryEndpoints.queue }
        { name: 'EmailQueue__queueServiceUri', value: queueStorage.properties.primaryEndpoints.queue }
        { name: 'EmailQueue__credential', value: 'managedidentity' }
        { name: 'EmailQueue__clientId', value: base.outputs.functionIdentityClientId }
        { name: 'ACS_RESOURCE_ID', value: acsSource.id }
        { name: 'EMAIL_STATE_TABLE_URL', value: base.outputs.storageTableEndpoint }
        { name: 'EMAIL_DEDUPE_SECRET', value: '@Microsoft.KeyVault(SecretUri=${base.outputs.dedupeSecretUri})' }
        { name: 'CRON_SECRET', value: '@Microsoft.KeyVault(SecretUri=${base.outputs.sweepSecretUri})' }
        { name: 'EXAM_SWEEP_URL', value: examSweepUrl }
        { name: 'EXAM_SWEEP_ENABLED', value: string(examSweepEnabled) }
        { name: 'ENTRA_EXTENSION_TENANT_ID', value: entraExternalTenantId }
        { name: 'ENTRA_EXTENSION_ISSUER', value: entraExtensionIssuer }
        { name: 'ENTRA_EXTENSION_AUDIENCE', value: entraExtensionAudience }
        { name: 'ENTRA_EXTENSION_ID', value: entraExtensionId }
        { name: 'ENTRA_CLIENT_ID', value: entraClientId }
        { name: 'ACS_ENDPOINT', value: 'https://${base.outputs.acsHostName}' }
        { name: 'COST_OPERATOR_JSON', value: string(costOperator) }
        { name: 'ACS_SENDER_ADDRESS', value: '${emailSenderLocalPart}@${emailDomainName}' }
      ]
    }
  }
}
output postgrestUrl string = base.outputs.postgrestUrl
output postgresHost string = base.outputs.postgresHost
output vaultName string = base.outputs.vaultName
output functionAppName string = functions.name
output emailExtensionUrl string = 'https://${functions.properties.defaultHostName}/api/entra/email-otp'
output emailDomainResourceId string = base.outputs.emailDomainResourceId
output emailVerificationRecords object = base.outputs.emailVerificationRecords
output storageAccountName string = base.outputs.storageAccountName
