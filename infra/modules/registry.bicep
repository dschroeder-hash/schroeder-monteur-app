param name string
param location string
param tags object
@allowed(['Basic', 'Standard'])
param sku string
@description('Principals allowed to pull images (api, worker, app, bc-mock identities).')
param pullPrincipalIds array

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: sku }
  properties: {
    adminUserEnabled: false
  }
}

var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for p in pullPrincipalIds: {
  name: guid(acr.id, p, acrPullRoleId)
  scope: acr
  properties: {
    principalId: p
    roleDefinitionId: acrPullRoleId
    principalType: 'ServicePrincipal'
  }
}]

output loginServer string = acr.properties.loginServer
output id string = acr.id
