param name string
param location string
param tags object
@description('api (upload SAS via user delegation key) and worker (retention deletes).')
param blobContributorPrincipalIds array
@description('Origins allowed for direct browser uploads, e.g. https://werkstatt.schroeder-gruppe.de')
param corsOrigins array
param isProd bool

resource sa 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: isProd ? 'Standard_ZRS' : 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // SAS links are issued as user delegation SAS (Entra), so shared keys are disabled.
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource blob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: sa
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 14 }
    containerDeleteRetentionPolicy: { enabled: true, days: 14 }
    cors: {
      corsRules: [
        {
          // Direct browser upload (Put Block / Put Block List) with SAS – only from the app's origin(s).
          allowedOrigins: corsOrigins
          allowedMethods: ['GET', 'PUT', 'HEAD', 'OPTIONS']
          allowedHeaders: ['*']
          exposedHeaders: ['*']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource photos 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'photos'
  properties: { publicAccess: 'None' }
}

// Placeholder lifecycle policy: real deletion is driven by the app's retention job
// (configurable per location). This rule only cleans up abandoned uncommitted uploads.
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: sa
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'photos-tier-cool'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['photos/'] }
            actions: {
              baseBlob: { tierToCool: { daysAfterModificationGreaterThan: 90 } }
            }
          }
        }
      ]
    }
  }
}

// Storage Blob Data Contributor + Storage Blob Delegator (needed for user delegation SAS)
var contributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var delegatorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a')

resource contributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for p in blobContributorPrincipalIds: {
  name: guid(sa.id, p, contributorRoleId)
  scope: sa
  properties: {
    principalId: p
    roleDefinitionId: contributorRoleId
    principalType: 'ServicePrincipal'
  }
}]

resource delegator 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for p in blobContributorPrincipalIds: {
  name: guid(sa.id, p, delegatorRoleId)
  scope: sa
  properties: {
    principalId: p
    roleDefinitionId: delegatorRoleId
    principalType: 'ServicePrincipal'
  }
}]

output blobEndpoint string = sa.properties.primaryEndpoints.blob
output name string = sa.name
