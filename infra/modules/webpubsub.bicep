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
    disableLocalAuth: false
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

output hostName string = wps.properties.hostName
output id string = wps.id
