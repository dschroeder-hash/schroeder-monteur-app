param name string
param location string
param tags object
@allowed(['Free_F1', 'Standard_S1', 'Premium_P1'])
param skuName string

resource wps 'Microsoft.SignalRService/webPubSub@2024-03-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    capacity: 1
  }
  properties: {
    // Managed identity only – no access keys (the API uses WEB_PUBSUB_ENDPOINT + its identity).
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource hub 'Microsoft.SignalRService/webPubSub/hubs@2024-03-01' = {
  parent: wps
  name: 'werkstatt'
  properties: {
    // Clients only join groups granted by the API-issued token.
    anonymousConnectPolicy: 'Deny'
  }
}

@description('Principals that publish messages and issue client tokens (api, worker).')
param ownerPrincipalIds array = []

// Web PubSub Service Owner
var ownerRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '12cf5a90-567b-43ae-8102-96cf46c7d9b4')
resource owner 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for p in ownerPrincipalIds: {
  name: guid(wps.id, p, ownerRoleId)
  scope: wps
  properties: {
    principalId: p
    roleDefinitionId: ownerRoleId
    principalType: 'ServicePrincipal'
  }
}]

output hostName string = wps.properties.hostName
output id string = wps.id
