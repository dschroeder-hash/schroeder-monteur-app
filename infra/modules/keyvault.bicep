param name string
param location string
param tags object
param tenantId string
param enablePurgeProtection bool
@description('Only api and worker read secrets – never the Next.js app (E-57).')
param secretsUserPrincipalIds array
param logAnalyticsWorkspaceId string

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    // Purge protection cannot be disabled once enabled; only set it in prod.
    enablePurgeProtection: enablePurgeProtection ? true : null
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

// Key Vault Secrets User
var secretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for p in secretsUserPrincipalIds: {
  name: guid(kv.id, p, secretsUserRoleId)
  scope: kv
  properties: {
    principalId: p
    roleDefinitionId: secretsUserRoleId
    principalType: 'ServicePrincipal'
  }
}]

resource diag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'audit'
  scope: kv
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [{ categoryGroup: 'audit', enabled: true }]
  }
}

output uri string = kv.properties.vaultUri
output name string = kv.name
