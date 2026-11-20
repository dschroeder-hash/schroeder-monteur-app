// Schröder Monteur-App – Azure infrastructure (resource group scope).
// Region: Germany West Central. Environments: dev | test | prod.
targetScope = 'resourceGroup'

@allowed(['dev', 'test', 'prod'])
param env string

param location string = 'germanywestcentral'

@description('Container image tag deployed for app, api, worker and bc-mock.')
param imageTag string = 'latest'

@description('Deploy Azure Front Door Premium with WAF in front of app and api.')
param enableFrontDoor bool = false

@description('Object ID of the Entra group that administers PostgreSQL (Entra auth).')
param postgresAdminGroupObjectId string

@description('Display name of the Entra group that administers PostgreSQL.')
param postgresAdminGroupName string

@description('Entra tenant ID.')
param tenantId string = subscription().tenantId

@description('Public base URL of the app (used for CORS / redirect), e.g. https://werkstatt.schroeder-gruppe.de')
param appBaseUrl string = ''

@description('BC mode used by api/worker: mock | sandbox | production')
@allowed(['mock', 'sandbox', 'production'])
param bcMode string = 'mock'

param vnetAddressPrefix string = '10.40.0.0/16'

@description('Application ID URI of the API app registration, e.g. api://werkstatt-api')
param entraApiAudience string

@description('Client ID of the SPA app registration (only this client may call the API).')
param entraClientId string

@description('Front Door profile id (frontDoorId) – set after the first deployment; then only Front Door traffic is accepted.')
param frontDoorId string = ''

var prefix = 'schr-monteur-${env}'
// Names without dashes for resources that do not allow them (max 24 chars).
var compactPrefix = 'schrmont${env}'
var isProd = env == 'prod'
var tags = {
  application: 'monteur-app'
  environment: env
  owner: 'schroeder-gruppe'
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    prefix: prefix
    location: location
    tags: tags
    retentionDays: isProd ? 90 : 30
  }
}

// One identity per component (E-57): the API may only become member of monteur_app, the worker of monteur_worker;
// the Next.js app gets no secrets, no storage and no database access at all.
module idApi 'modules/identity.bicep' = {
  name: 'identity-api'
  params: { name: '${prefix}-id-api', location: location, tags: tags }
}
module idWorker 'modules/identity.bicep' = {
  name: 'identity-worker'
  params: { name: '${prefix}-id-worker', location: location, tags: tags }
}
module idMigrate 'modules/identity.bicep' = {
  name: 'identity-migrate'
  params: { name: '${prefix}-id-migrate', location: location, tags: tags }
}
module idApp 'modules/identity.bicep' = {
  name: 'identity-app'
  params: { name: '${prefix}-id-app', location: location, tags: tags }
}

module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    prefix: prefix
    location: location
    tags: tags
    addressPrefix: vnetAddressPrefix
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    name: '${compactPrefix}cr'
    location: location
    tags: tags
    sku: isProd ? 'Standard' : 'Basic'
    pullPrincipalIds: [
      idApi.outputs.principalId
      idWorker.outputs.principalId
      idApp.outputs.principalId
      idMigrate.outputs.principalId
    ]
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    name: '${compactPrefix}kv'
    location: location
    tags: tags
    tenantId: tenantId
    enablePurgeProtection: isProd
    secretsUserPrincipalIds: [idApi.outputs.principalId, idWorker.outputs.principalId]
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    name: '${prefix}-psql'
    location: location
    tags: tags
    delegatedSubnetId: network.outputs.postgresSubnetId
    vnetId: network.outputs.vnetId
    tenantId: tenantId
    adminGroupObjectId: postgresAdminGroupObjectId
    adminGroupName: postgresAdminGroupName
    migrationPrincipalId: idMigrate.outputs.principalId
    migrationPrincipalName: '${prefix}-id-migrate'
    skuName: isProd ? 'Standard_D2ds_v5' : 'Standard_B1ms'
    skuTier: isProd ? 'GeneralPurpose' : 'Burstable'
    storageSizeGB: isProd ? 128 : 32
    backupRetentionDays: isProd ? 35 : 7
    highAvailability: isProd
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    name: '${compactPrefix}st'
    location: location
    tags: tags
    blobContributorPrincipalIds: [idApi.outputs.principalId, idWorker.outputs.principalId]
    corsOrigins: empty(appBaseUrl) ? ['https://${prefix}-app.invalid'] : [appBaseUrl]
    isProd: isProd
  }
}

module webPubSub 'modules/webpubsub.bicep' = {
  name: 'webpubsub'
  params: {
    name: '${prefix}-wps'
    location: location
    tags: tags
    skuName: isProd ? 'Standard_S1' : 'Free_F1'
    ownerPrincipalIds: [idApi.outputs.principalId, idWorker.outputs.principalId]
  }
}

module containerApps 'modules/containerapps.bicep' = {
  name: 'containerapps'
  params: {
    prefix: prefix
    location: location
    tags: tags
    env: env
    infrastructureSubnetId: network.outputs.appsSubnetId
    logAnalyticsWorkspaceName: monitoring.outputs.workspaceName
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    apiIdentityId: idApi.outputs.id
    apiIdentityClientId: idApi.outputs.clientId
    apiIdentityName: '${prefix}-id-api'
    workerIdentityId: idWorker.outputs.id
    workerIdentityClientId: idWorker.outputs.clientId
    workerIdentityName: '${prefix}-id-worker'
    appIdentityId: idApp.outputs.id
    migrateIdentityId: idMigrate.outputs.id
    migrateIdentityClientId: idMigrate.outputs.clientId
    migrateIdentityName: '${prefix}-id-migrate'
    entraTenantId: tenantId
    entraApiAudience: entraApiAudience
    entraClientId: entraClientId
    postgresHost: postgres.outputs.fqdn
    frontDoorId: frontDoorId
    webPubSubEndpoint: 'https://${webPubSub.outputs.hostName}'
    registryLoginServer: registry.outputs.loginServer
    keyVaultUri: keyVault.outputs.uri
    storageBlobEndpoint: storage.outputs.blobEndpoint
    imageTag: imageTag
    deployBcMock: !isProd
    bcMode: bcMode
    appBaseUrl: appBaseUrl
    zoneRedundant: isProd
  }
}

module frontDoor 'modules/frontdoor.bicep' = if (enableFrontDoor) {
  name: 'frontdoor'
  params: {
    prefix: prefix
    tags: tags
    appHostName: containerApps.outputs.appFqdn
    apiHostName: containerApps.outputs.apiFqdn
    wafMode: isProd ? 'Prevention' : 'Detection'
  }
}

output appUrl string = 'https://${containerApps.outputs.appFqdn}'
output apiUrl string = 'https://${containerApps.outputs.apiFqdn}'
output frontDoorEndpoint string = enableFrontDoor ? frontDoor!.outputs.endpointHostName : ''
output keyVaultName string = keyVault.outputs.name
output registryLoginServer string = registry.outputs.loginServer
output postgresFqdn string = postgres.outputs.fqdn
output migrationJobName string = containerApps.outputs.migrationJobName
output apiIdentityName string = '${prefix}-id-api'
output workerIdentityName string = '${prefix}-id-worker'
